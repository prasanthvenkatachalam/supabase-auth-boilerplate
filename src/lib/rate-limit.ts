/**
 * Rate Limiting Utilities
 * ============================================================
 *
 * This module provides all rate-limiting logic for the application's
 * authentication API routes. It is the only place in the codebase that
 * creates and manages Upstash Ratelimit instances.
 *
 * ──────────────────────────────────────────────────────────────
 * HOW IT WORKS — THE BASICS
 * ──────────────────────────────────────────────────────────────
 *
 * Rate limiting answers the question: "Is this request allowed, or has the
 * caller sent too many requests in a given time window?"
 *
 * Every time an API is called, we:
 *   1. Pick an identifier for the caller (their IP address, email, etc.)
 *   2. Atomically increment a counter in Redis for that identifier.
 *   3. If the counter exceeds the configured LIMIT, we reject the request
 *      with HTTP 429 Too Many Requests.
 *   4. After the WINDOW expires, Redis automatically deletes the key
 *      and the counter resets to zero.
 *
 * ──────────────────────────────────────────────────────────────
 * INFRASTRUCTURE
 * ──────────────────────────────────────────────────────────────
 *
 * - Storage:   Upstash Redis (serverless Redis with an HTTP API,
 *              compatible with edge/serverless environments like Vercel)
 * - Library:   @upstash/ratelimit  — wraps Redis with sliding-window logic
 * - Algorithm: Sliding Window (default choice in this codebase)
 *
 * ──────────────────────────────────────────────────────────────
 * ALGORITHMS — QUICK REFERENCE
 * ──────────────────────────────────────────────────────────────
 *
 * slidingWindow(N, "T"):
 *   The most accurate algorithm. Tracks requests over a continuously
 *   rolling window instead of fixed intervals. Example: if the window
 *   is 1 minute and the limit is 5, a user who sends 5 requests at
 *   00:55 cannot send another until 01:55. This prevents "double-spend"
 *   attacks at window boundaries.
 *
 * fixedWindow(N, "T"):
 *   Simpler and cheaper. Resets the counter at fixed clock intervals
 *   (e.g., every hour on the hour). Vulnerable to boundary bursts:
 *   a user can send N requests just before midnight and N more just
 *   after, effectively getting 2×N in a short period.
 *
 * tokenBucket(N, "T"):
 *   Allows controlled bursts. Tokens refill at a steady rate.
 *   Good for APIs where occasional spikes are acceptable.
 *
 * We use slidingWindow everywhere for accuracy.
 *
 * ──────────────────────────────────────────────────────────────
 * DEFENSE-IN-DEPTH: THREE TIERS
 * ──────────────────────────────────────────────────────────────
 *
 * For email-based endpoints (signup, login, forgot-password, etc.) we
 * run three independent checks in parallel:
 *
 *   GLOBAL  — One counter shared by every caller. Trips if the whole
 *              system is under a DDoS or botnet attack, regardless
 *              of how many IPs are involved.
 *
 *   IP      — One counter per IP address. Blocks a single bot or
 *              attacker that is not rotating IPs.
 *
 *   EMAIL   — One counter per email address. Blocks attacks that
 *              target a specific account even when the attacker
 *              rotates their IP.
 *
 * For token-based endpoints (verify-email, verify-otp, set-recovery-session)
 * the request body does not contain an email, so only GLOBAL + IP are used.
 *
 * ──────────────────────────────────────────────────────────────
 * FAIL-OPEN POLICY
 * ──────────────────────────────────────────────────────────────
 *
 * If Redis is unreachable (network blip, Upstash outage), every
 * `check*` function catches the error and returns `{ allowed: true }`.
 * This is called "failing open" — we prefer availability over strict
 * enforcement in degraded conditions.
 *
 * Trade-off: during a Redis outage, rate limits are not enforced.
 * Alternative "fail closed" would block all traffic during an outage —
 * a worse outcome for most auth flows (legitimate users can't log in).
 *
 * ──────────────────────────────────────────────────────────────
 * EPHEMERAL CACHE
 * ──────────────────────────────────────────────────────────────
 *
 * Each `Ratelimit` instance is given `ephemeralCache: new Map()`.
 * This is an in-process (in-memory) cache that stores the result of
 * the last Redis round-trip for a few milliseconds. It prevents
 * redundant Redis calls when the same identifier hits the same
 * serverless function instance multiple times in rapid succession.
 *
 * Important: because Next.js serverless functions can have many
 * instances, the ephemeral cache is NOT shared across instances —
 * it is purely a local micro-optimization within one function invocation.
 */

import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { redis } from "@/lib/upstash";
import { RATE_LIMIT_CONFIG } from "@/constants/rate-limit";

// ─────────────────────────────────────────────────────────────────────────────
// SHARED TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which dimension of rate limiting tripped.
 *
 * - "global" → system-wide counter exceeded
 * - "ip"     → per-IP counter exceeded
 * - "email"  → per-email counter exceeded
 */
type RateLimitScope = "global" | "ip" | "email";

/**
 * The object returned by every `check*RateLimit` function.
 *
 * When `allowed` is false, the API route should respond with HTTP 429.
 * The other fields can be used to populate standard rate-limit response
 * headers (X-RateLimit-*) so clients know when they can retry.
 */
export type RateLimitCheckResult = {
  /** Whether the request is allowed to proceed. */
  allowed: boolean;
  /** Which tier tripped (only present when allowed === false). */
  limitType?: RateLimitScope;
  /** The maximum number of requests allowed in the window. */
  limit?: number;
  /** How many requests are still allowed before the limit is reached. */
  remaining?: number;
  /** When the current window resets and the counter returns to 0. */
  resetAt?: Date;
};

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes an email address before using it as a Redis key identifier.
 *
 * Why?  "User@Example.COM" and "user@example.com" refer to the same
 * mailbox. Without normalization, an attacker could bypass per-email
 * limits by varying the case of their email.
 *
 * @param email - Raw email from the request body.
 * @returns The trimmed, lower-cased version of the email.
 */
function sanitizeRateLimitEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Factory function that creates a pre-configured Upstash `Ratelimit` instance.
 *
 * All limiter instances in this file use the same options:
 *   - Sliding window algorithm
 *   - analytics disabled (we don't need Upstash's built-in analytics dashboard)
 *   - ephemeralCache enabled for micro-caching within a single invocation
 *
 * By centralizing construction here, we avoid repeating the same 8-line
 * `new Ratelimit(...)` block for every tier of every endpoint.
 *
 * @param limit  - Maximum allowed requests in the window (from RATE_LIMIT_CONFIG).
 * @param window - Duration string e.g. "15 m", "1 h" (from RATE_LIMIT_CONFIG).
 * @param prefix - Redis key prefix e.g. "ratelimit:signup:ip:" (from RATE_LIMIT_CONFIG).
 * @returns A ready-to-use `Ratelimit` instance.
 */
function createLimiter(limit: number, window: string, prefix: string): Ratelimit {
  return new Ratelimit({
    redis,
    // slidingWindow is the most accurate algorithm — see module-level comment above.
    limiter: Ratelimit.slidingWindow(limit, window as Duration),
    // Disabling analytics keeps Redis writes minimal.
    analytics: false,
    // The prefix namespaces all Redis keys for this specific limiter.
    // Full key format: "<prefix><identifier>"
    // e.g. "ratelimit:signup:ip:203.0.113.42"
    prefix,
    // In-process cache. See module-level ephemeralCache section above.
    ephemeralCache: new Map(),
  });
}

/**
 * A raw limiter result as returned by Upstash after a `.limit()` call.
 * Used internally to pass results between helper functions.
 */
type LimiterResult = {
  success: boolean; // true → request is under the limit; false → limit exceeded
  limit: number;    // the configured maximum (mirrors RATE_LIMIT_CONFIG)
  remaining: number; // how many more requests are allowed before the window resets
  reset: number;    // Unix timestamp (ms) when the window resets
};

/**
 * Scans a list of limiter results in declared priority order and returns a
 * "429 blocked" result for the FIRST tier that exceeded its limit.
 *
 * Priority order matters: we report GLOBAL first so the caller can distinguish
 * a system-wide outage from a per-user block.
 *
 * @param checks - Ordered list of { type, ...limiterResult } objects.
 * @returns A blocked `RateLimitCheckResult` if any tier exceeded its limit,
 *          or `null` if all tiers are within their limits.
 */
function resolveExceededLimiter(
  checks: Array<{ type: RateLimitScope } & LimiterResult>
): RateLimitCheckResult | null {
  for (const check of checks) {
    if (!check.success) {
      // This tier is over limit — build the "blocked" response.
      return {
        allowed: false,
        limitType: check.type,
        limit: check.limit,
        remaining: check.remaining,
        resetAt: new Date(check.reset),
      };
    }
  }
  // All tiers are within limits.
  return null;
}

/**
 * Builds a successful (allowed) `RateLimitCheckResult` from a set of
 * limiter results.
 *
 * The `remaining` count is the MINIMUM across all tiers — this tells the
 * client how many requests it can still make before hitting the most
 * restrictive limit. The `limit` and `resetAt` come from the `reference`
 * limiter (typically the most specific one, e.g. the email limiter).
 *
 * @param checks    - All limiter results to take the minimum remaining from.
 * @param reference - The limiter whose `limit` and `reset` will be reported.
 * @returns An "allowed" `RateLimitCheckResult`.
 */
function buildAllowedResult(
  checks: LimiterResult[],
  reference: Pick<LimiterResult, "limit" | "reset">
): RateLimitCheckResult {
  return {
    allowed: true,
    // Report the smallest "remaining" count across all tiers.
    // This prevents the client from thinking it has more headroom than it does.
    remaining: Math.min(...checks.map((c) => c.remaining)),
    limit: reference.limit,
    resetAt: new Date(reference.reset),
  };
}

/**
 * Core logic for a THREE-tier rate limit check (Global → IP → Email).
 *
 * Used by every endpoint that accepts an email address in the request body:
 * signup, login, forgot-password, reset-password, resend-verification.
 *
 * All three limiters are queried IN PARALLEL via Promise.all to avoid
 * adding three sequential round-trips (~3× latency) to every request.
 *
 * @param globalLimiter - The endpoint's global-scoped Ratelimit instance.
 * @param ipLimiter     - The endpoint's IP-scoped Ratelimit instance.
 * @param emailLimiter  - The endpoint's email-scoped Ratelimit instance.
 * @param ip            - Client IP address (used as the key for ipLimiter).
 * @param email         - Normalised email address (used as the key for emailLimiter).
 * @param context       - Human-readable label used in error log messages (e.g. "signup").
 * @returns A `RateLimitCheckResult` indicating whether the request is allowed.
 */
async function checkThreeTierRateLimit(
  globalLimiter: Ratelimit,
  ipLimiter: Ratelimit,
  emailLimiter: Ratelimit,
  ip: string,
  email: string,
  context: string
): Promise<RateLimitCheckResult> {
  try {
    // Fire all three Redis increments simultaneously.
    // Each call atomically increments the counter for its identifier and
    // returns the updated count plus metadata.
    const [globalResult, ipResult, emailResult] = await Promise.all([
      globalLimiter.limit("global"),          // One shared key: "<prefix>global"
      ipLimiter.limit(ip),                    // Per-IP key:     "<prefix>203.0.113.42"
      emailLimiter.limit(sanitizeRateLimitEmail(email)), // Per-email key: "<prefix>user@example.com"
    ]);

    // Evaluate tiers in priority order: global first, then IP, then email.
    // Reporting the "most severe" block type helps with observability.
    const exceeded = resolveExceededLimiter([
      { type: "global", ...globalResult },
      { type: "ip",     ...ipResult },
      { type: "email",  ...emailResult },
    ]);

    // If any tier is over its limit, reject the request immediately.
    if (exceeded) return exceeded;

    // All tiers passed — build the success payload using the email limiter
    // as the reference (most specific / most restrictive per user).
    return buildAllowedResult([globalResult, ipResult, emailResult], emailResult);
  } catch (error) {
    // FAIL-OPEN: if Redis is unreachable, allow the request to proceed
    // rather than blocking all users during an infrastructure outage.
    // See the module-level "FAIL-OPEN POLICY" comment for the rationale.
    console.error(`[rate-limit] ${context} check failed — failing open:`, error);
    return { allowed: true };
  }
}

/**
 * Core logic for a TWO-tier rate limit check (Global → IP).
 *
 * Used by token-based endpoints that do NOT receive an email address:
 * verify-email, verify-otp, set-recovery-session.
 *
 * @param globalLimiter - The endpoint's global-scoped Ratelimit instance.
 * @param ipLimiter     - The endpoint's IP-scoped Ratelimit instance.
 * @param ip            - Client IP address.
 * @param context       - Human-readable label for error logs.
 * @returns A `RateLimitCheckResult`.
 */
async function checkTwoTierRateLimit(
  globalLimiter: Ratelimit,
  ipLimiter: Ratelimit,
  ip: string,
  context: string
): Promise<RateLimitCheckResult> {
  try {
    // Two checks in parallel — no email tier for token-based endpoints.
    const [globalResult, ipResult] = await Promise.all([
      globalLimiter.limit("global"),
      ipLimiter.limit(ip),
    ]);

    const exceeded = resolveExceededLimiter([
      { type: "global", ...globalResult },
      { type: "ip",     ...ipResult },
    ]);

    if (exceeded) return exceeded;

    return buildAllowedResult([globalResult, ipResult], ipResult);
  } catch (error) {
    console.error(`[rate-limit] ${context} check failed — failing open:`, error);
    return { allowed: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNUP — POST /api/auth/signup
// ─────────────────────────────────────────────────────────────────────────────
// Three-tier (global + IP + email). Conservative limits to deter throwaway
// account creation and email-verification spam.

const signupIpLimiter     = createLimiter(RATE_LIMIT_CONFIG.SIGNUP.IP.LIMIT,     RATE_LIMIT_CONFIG.SIGNUP.IP.WINDOW,     RATE_LIMIT_CONFIG.SIGNUP.IP.PREFIX);
const signupEmailLimiter  = createLimiter(RATE_LIMIT_CONFIG.SIGNUP.EMAIL.LIMIT,  RATE_LIMIT_CONFIG.SIGNUP.EMAIL.WINDOW,  RATE_LIMIT_CONFIG.SIGNUP.EMAIL.PREFIX);
const signupGlobalLimiter = createLimiter(RATE_LIMIT_CONFIG.SIGNUP.GLOBAL.LIMIT, RATE_LIMIT_CONFIG.SIGNUP.GLOBAL.WINDOW, RATE_LIMIT_CONFIG.SIGNUP.GLOBAL.PREFIX);

/**
 * Checks all rate limit tiers for the signup endpoint.
 *
 * Call this at the start of `POST /api/auth/signup` before any database
 * or email operations. If `allowed` is false, return HTTP 429 immediately.
 *
 * @param ip    - Client IP address, extracted from request headers.
 * @param email - Email address from the signup form.
 * @returns `RateLimitCheckResult` — check `allowed` before proceeding.
 */
export async function checkSignupRateLimit(
  ip: string,
  email: string
): Promise<RateLimitCheckResult> {
  return checkThreeTierRateLimit(
    signupGlobalLimiter,
    signupIpLimiter,
    signupEmailLimiter,
    ip,
    email,
    "signup"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN — POST /api/auth/login  (or Supabase's signInWithPassword)
// ─────────────────────────────────────────────────────────────────────────────
// Three-tier. Stricter per-email limits than signup to slow credential stuffing.

const loginIpLimiter     = createLimiter(RATE_LIMIT_CONFIG.LOGIN.IP.LIMIT,     RATE_LIMIT_CONFIG.LOGIN.IP.WINDOW,     RATE_LIMIT_CONFIG.LOGIN.IP.PREFIX);
const loginEmailLimiter  = createLimiter(RATE_LIMIT_CONFIG.LOGIN.EMAIL.LIMIT,  RATE_LIMIT_CONFIG.LOGIN.EMAIL.WINDOW,  RATE_LIMIT_CONFIG.LOGIN.EMAIL.PREFIX);
const loginGlobalLimiter = createLimiter(RATE_LIMIT_CONFIG.LOGIN.GLOBAL.LIMIT, RATE_LIMIT_CONFIG.LOGIN.GLOBAL.WINDOW, RATE_LIMIT_CONFIG.LOGIN.GLOBAL.PREFIX);

/**
 * Checks all rate limit tiers for the login endpoint.
 *
 * @param ip    - Client IP address.
 * @param email - Email address from the login form.
 * @returns `RateLimitCheckResult`.
 */
export async function checkLoginRateLimit(
  ip: string,
  email: string
): Promise<RateLimitCheckResult> {
  return checkThreeTierRateLimit(
    loginGlobalLimiter,
    loginIpLimiter,
    loginEmailLimiter,
    ip,
    email,
    "login"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RESEND VERIFICATION — POST /api/auth/resend-verification
// ─────────────────────────────────────────────────────────────────────────────
// Three-tier. Prevents email-flooding a victim's inbox via resend requests.

const resendVerificationIpLimiter     = createLimiter(RATE_LIMIT_CONFIG.RESEND_VERIFICATION.IP.LIMIT,     RATE_LIMIT_CONFIG.RESEND_VERIFICATION.IP.WINDOW,     RATE_LIMIT_CONFIG.RESEND_VERIFICATION.IP.PREFIX);
const resendVerificationEmailLimiter  = createLimiter(RATE_LIMIT_CONFIG.RESEND_VERIFICATION.EMAIL.LIMIT,  RATE_LIMIT_CONFIG.RESEND_VERIFICATION.EMAIL.WINDOW,  RATE_LIMIT_CONFIG.RESEND_VERIFICATION.EMAIL.PREFIX);
const resendVerificationGlobalLimiter = createLimiter(RATE_LIMIT_CONFIG.RESEND_VERIFICATION.GLOBAL.LIMIT, RATE_LIMIT_CONFIG.RESEND_VERIFICATION.GLOBAL.WINDOW, RATE_LIMIT_CONFIG.RESEND_VERIFICATION.GLOBAL.PREFIX);

/**
 * Checks all rate limit tiers for the resend-verification endpoint.
 *
 * @param ip    - Client IP address.
 * @param email - Email address from the resend form.
 * @returns `RateLimitCheckResult`.
 */
export async function checkResendVerificationRateLimit(
  ip: string,
  email: string
): Promise<RateLimitCheckResult> {
  return checkThreeTierRateLimit(
    resendVerificationGlobalLimiter,
    resendVerificationIpLimiter,
    resendVerificationEmailLimiter,
    ip,
    email,
    "resend-verification"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FORGOT PASSWORD — POST /api/auth/forgot-password
// ─────────────────────────────────────────────────────────────────────────────
// Three-tier. Primary protection against email-bombing and reset-link spam.
// This endpoint calls the Supabase Admin API and our email provider, so
// limiting it aggressively protects both our quota and the recipient.

const forgotPasswordIpLimiter     = createLimiter(RATE_LIMIT_CONFIG.FORGOT_PASSWORD.IP.LIMIT,     RATE_LIMIT_CONFIG.FORGOT_PASSWORD.IP.WINDOW,     RATE_LIMIT_CONFIG.FORGOT_PASSWORD.IP.PREFIX);
const forgotPasswordEmailLimiter  = createLimiter(RATE_LIMIT_CONFIG.FORGOT_PASSWORD.EMAIL.LIMIT,  RATE_LIMIT_CONFIG.FORGOT_PASSWORD.EMAIL.WINDOW,  RATE_LIMIT_CONFIG.FORGOT_PASSWORD.EMAIL.PREFIX);
const forgotPasswordGlobalLimiter = createLimiter(RATE_LIMIT_CONFIG.FORGOT_PASSWORD.GLOBAL.LIMIT, RATE_LIMIT_CONFIG.FORGOT_PASSWORD.GLOBAL.WINDOW, RATE_LIMIT_CONFIG.FORGOT_PASSWORD.GLOBAL.PREFIX);

/**
 * Checks all rate limit tiers for the forgot-password endpoint.
 *
 * @param ip    - Client IP address.
 * @param email - Email address from the forgot-password form.
 * @returns `RateLimitCheckResult`.
 */
export async function checkForgotPasswordRateLimit(
  ip: string,
  email: string
): Promise<RateLimitCheckResult> {
  return checkThreeTierRateLimit(
    forgotPasswordGlobalLimiter,
    forgotPasswordIpLimiter,
    forgotPasswordEmailLimiter,
    ip,
    email,
    "forgot-password"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RESET PASSWORD — POST /api/auth/reset-password
// ─────────────────────────────────────────────────────────────────────────────
// Three-tier. User is already authenticated via recovery session at this point,
// but we still limit to prevent automated password-cycling attacks.

const resetPasswordIpLimiter     = createLimiter(RATE_LIMIT_CONFIG.RESET_PASSWORD.IP.LIMIT,     RATE_LIMIT_CONFIG.RESET_PASSWORD.IP.WINDOW,     RATE_LIMIT_CONFIG.RESET_PASSWORD.IP.PREFIX);
const resetPasswordEmailLimiter  = createLimiter(RATE_LIMIT_CONFIG.RESET_PASSWORD.EMAIL.LIMIT,  RATE_LIMIT_CONFIG.RESET_PASSWORD.EMAIL.WINDOW,  RATE_LIMIT_CONFIG.RESET_PASSWORD.EMAIL.PREFIX);
const resetPasswordGlobalLimiter = createLimiter(RATE_LIMIT_CONFIG.RESET_PASSWORD.GLOBAL.LIMIT, RATE_LIMIT_CONFIG.RESET_PASSWORD.GLOBAL.WINDOW, RATE_LIMIT_CONFIG.RESET_PASSWORD.GLOBAL.PREFIX);

/**
 * Checks all rate limit tiers for the reset-password endpoint.
 *
 * @param ip    - Client IP address.
 * @param email - Email address of the authenticated user (from session).
 * @returns `RateLimitCheckResult`.
 */
export async function checkResetPasswordRateLimit(
  ip: string,
  email: string
): Promise<RateLimitCheckResult> {
  return checkThreeTierRateLimit(
    resetPasswordGlobalLimiter,
    resetPasswordIpLimiter,
    resetPasswordEmailLimiter,
    ip,
    email,
    "reset-password"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY EMAIL — GET /api/auth/verify-email
// ─────────────────────────────────────────────────────────────────────────────
// Two-tier (global + IP only). The request body contains a token, not an email,
// so an email-scoped limiter is not applicable. Limits are looser because
// the user arrives here via an email link click and may retry across tabs.

const verifyEmailIpLimiter     = createLimiter(RATE_LIMIT_CONFIG.VERIFY_EMAIL.IP.LIMIT,     RATE_LIMIT_CONFIG.VERIFY_EMAIL.IP.WINDOW,     RATE_LIMIT_CONFIG.VERIFY_EMAIL.IP.PREFIX);
const verifyEmailGlobalLimiter = createLimiter(RATE_LIMIT_CONFIG.VERIFY_EMAIL.GLOBAL.LIMIT, RATE_LIMIT_CONFIG.VERIFY_EMAIL.GLOBAL.WINDOW, RATE_LIMIT_CONFIG.VERIFY_EMAIL.GLOBAL.PREFIX);

/**
 * Checks rate limit tiers for the verify-email endpoint (IP + Global only).
 *
 * @param ip - Client IP address.
 * @returns `RateLimitCheckResult`.
 */
export async function checkVerifyEmailRateLimit(ip: string): Promise<RateLimitCheckResult> {
  return checkTwoTierRateLimit(verifyEmailGlobalLimiter, verifyEmailIpLimiter, ip, "verify-email");
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY OTP — POST /api/auth/verify-otp
// ─────────────────────────────────────────────────────────────────────────────
// Two-tier (global + IP only). OTP verification is also token-based with no
// email field. Limits mirror verify-email since the UX and threat model match.

const verifyOtpIpLimiter     = createLimiter(RATE_LIMIT_CONFIG.VERIFY_OTP.IP.LIMIT,     RATE_LIMIT_CONFIG.VERIFY_OTP.IP.WINDOW,     RATE_LIMIT_CONFIG.VERIFY_OTP.IP.PREFIX);
const verifyOtpGlobalLimiter = createLimiter(RATE_LIMIT_CONFIG.VERIFY_OTP.GLOBAL.LIMIT, RATE_LIMIT_CONFIG.VERIFY_OTP.GLOBAL.WINDOW, RATE_LIMIT_CONFIG.VERIFY_OTP.GLOBAL.PREFIX);

/**
 * Checks rate limit tiers for the verify-otp endpoint (IP + Global only).
 *
 * @param ip - Client IP address.
 * @returns `RateLimitCheckResult`.
 */
export async function checkVerifyOtpRateLimit(ip: string): Promise<RateLimitCheckResult> {
  return checkTwoTierRateLimit(verifyOtpGlobalLimiter, verifyOtpIpLimiter, ip, "verify-otp");
}

// ─────────────────────────────────────────────────────────────────────────────
// SET RECOVERY SESSION — POST /api/auth/set-recovery-session
// ─────────────────────────────────────────────────────────────────────────────
// Two-tier (global + IP only). This route consumes bearer-like tokens
// (access + refresh) from the reset-link URL and sets a session cookie.
// Limiting velocity here reduces token replay / credential-stuffing risk.

const setRecoverySessionIpLimiter     = createLimiter(RATE_LIMIT_CONFIG.SET_RECOVERY_SESSION.IP.LIMIT,     RATE_LIMIT_CONFIG.SET_RECOVERY_SESSION.IP.WINDOW,     RATE_LIMIT_CONFIG.SET_RECOVERY_SESSION.IP.PREFIX);
const setRecoverySessionGlobalLimiter = createLimiter(RATE_LIMIT_CONFIG.SET_RECOVERY_SESSION.GLOBAL.LIMIT, RATE_LIMIT_CONFIG.SET_RECOVERY_SESSION.GLOBAL.WINDOW, RATE_LIMIT_CONFIG.SET_RECOVERY_SESSION.GLOBAL.PREFIX);

/**
 * Checks rate limit tiers for the set-recovery-session endpoint (IP + Global only).
 *
 * @param ip - Client IP address.
 * @returns `RateLimitCheckResult`.
 */
export async function checkSetRecoverySessionRateLimit(ip: string): Promise<RateLimitCheckResult> {
  return checkTwoTierRateLimit(setRecoverySessionGlobalLimiter, setRecoverySessionIpLimiter, ip, "set-recovery-session");
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY: RESET A RATE LIMIT KEY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manually removes a rate limit key from Redis.
 *
 * Use this sparingly — typically in support scenarios where a legitimate
 * user has been accidentally blocked, or in test environments where you
 * need a clean slate between test runs.
 *
 * IMPORTANT: Do NOT expose this via a public API endpoint without
 * proper admin authentication.
 *
 * @param prefix     - The Redis key prefix for the specific limiter
 *                     (e.g. RATE_LIMIT_CONFIG.SIGNUP.IP.PREFIX).
 * @param identifier - The value appended to the prefix (an IP or email).
 *
 * @example
 * // Reset the signup IP counter for a specific IP
 * await resetRateLimitKey(RATE_LIMIT_CONFIG.SIGNUP.IP.PREFIX, "203.0.113.42");
 *
 * // Reset the forgot-password email counter for a specific user
 * await resetRateLimitKey(RATE_LIMIT_CONFIG.FORGOT_PASSWORD.EMAIL.PREFIX, "user@example.com");
 */
export async function resetRateLimitKey(prefix: string, identifier: string): Promise<void> {
  const key = `${prefix}${identifier}`;
  await redis.del(key);
}
