/**
 * Rate Limit Configuration
 *
 * This file is the single source of truth for all rate limiting parameters
 * across every API route in the application.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * GLOSSARY
 * ─────────────────────────────────────────────────────────────────────────
 *
 * LIMIT   — Maximum number of requests allowed within the WINDOW.
 *            Once this count is reached, further requests are blocked
 *            until the window resets.
 *
 * WINDOW  — The time period over which LIMIT is enforced.
 *            Format: "<number> <unit>" e.g. "15 m" = 15 minutes, "1 h" = 1 hour.
 *            Supported units: ms, s, m, h, d.
 *
 * PREFIX  — The key prefix used in Redis to namespace rate limit counters.
 *            Each unique identifier (IP or email) gets its own Redis key:
 *            e.g. "ratelimit:signup:ip:192.168.1.1"
 *            Using prefixes prevents key collisions between different endpoints.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TIER STRATEGY
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Each endpoint uses one or more of these "tiers":
 *
 *   IP      — Limits requests from a single IP address.
 *             Primary defense against a single attacker or bot.
 *
 *   EMAIL   — Limits requests targeting a specific email address.
 *             Prevents account enumeration and per-account spam,
 *             even if the attacker rotates their IP.
 *
 *   GLOBAL  — A single counter shared across ALL requests to an endpoint,
 *             regardless of IP or email.
 *             Acts as a system-wide circuit breaker to protect
 *             infrastructure under a mass distributed attack (e.g. botnet).
 *
 * Checks are evaluated in priority order: GLOBAL → IP → EMAIL.
 * If any tier is exceeded, the request is rejected with HTTP 429.
 */

export const RATE_LIMIT_CONFIG = {
  // ─────────────────────────────────────────────────────────────────────
  // POST /api/auth/signup
  //
  // Signup is a high-value target for creating throwaway accounts and
  // email-spamming. Limits are conservative to deter automated registration.
  // ─────────────────────────────────────────────────────────────────────
  SIGNUP: {
    IP: {
      // A real user rarely makes more than 1–2 signups from the same IP.
      // 3 per 15 minutes accommodates retries after typos.
      LIMIT: 3,
      WINDOW: "15 m",
      PREFIX: "ratelimit:signup:ip:",
    },
    EMAIL: {
      // An email address should only be signed up once.
      // 5 per hour is a generous allowance covering race conditions / support retries.
      LIMIT: 5,
      WINDOW: "1 h",
      PREFIX: "ratelimit:signup:email:",
    },
    GLOBAL: {
      // Guards the overall system against mass registration campaigns.
      // 100/minute = comfortable headroom for legitimate traffic spikes.
      LIMIT: 100,
      WINDOW: "1 m",
      PREFIX: "ratelimit:signup:global:",
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/auth/login  (or Supabase's built-in signInWithPassword)
  //
  // Login is the most common brute-force target. Limits are stricter
  // per-email to slow credential stuffing, but generous enough
  // per-IP to not frustrate shared networks (offices, NATs).
  // ─────────────────────────────────────────────────────────────────────
  LOGIN: {
    IP: {
      // 10 attempts per minute per IP is permissive for offices / shared Wi-Fi
      // while still catching automated attackers who cycle passwords fast.
      LIMIT: 10,
      WINDOW: "1 m",
      PREFIX: "ratelimit:login:ip:",
    },
    EMAIL: {
      // Only 5 failed logins per minute per account.
      // This directly counters credential-stuffing lists.
      LIMIT: 5,
      WINDOW: "1 m",
      PREFIX: "ratelimit:login:email:",
    },
    GLOBAL: {
      // 1000/minute system-wide. Provides a backstop in the event of
      // a massive distributed login attack (botnet with thousands of IPs).
      LIMIT: 1000,
      WINDOW: "1 m",
      PREFIX: "ratelimit:login:global:",
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/auth/resend-verification
  //
  // Users who need to resend their verification email are a
  // legitimate (but rare) use case. Limits prevent email flooding.
  // ─────────────────────────────────────────────────────────────────────
  RESEND_VERIFICATION: {
    IP: {
      // 10 resends per hour from one IP — handles shared machines (e.g. a library).
      LIMIT: 10,
      WINDOW: "1 h",
      PREFIX: "ratelimit:resend-verification:ip:",
    },
    EMAIL: {
      // 3 resends per hour per email is plenty for a legitimate user.
      // Beyond this, they should contact support.
      LIMIT: 3,
      WINDOW: "1 h",
      PREFIX: "ratelimit:resend-verification:email:",
    },
    GLOBAL: {
      // 100 resends per hour system-wide — prevents email-bombing campaigns.
      LIMIT: 100,
      WINDOW: "1 h",
      PREFIX: "ratelimit:resend-verification:global:",
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/auth/forgot-password
  //
  // This endpoint sends password reset emails. It is a classic target
  // for email-bombing (sending thousands of reset emails to a victim).
  // We must protect both our email quota and the recipient's inbox.
  // ─────────────────────────────────────────────────────────────────────
  FORGOT_PASSWORD: {
    IP: {
      // 3 per 15 minutes per IP — same conservative stance as Signup.
      // A real user submits this form once, maybe twice after not seeing the email.
      LIMIT: 3,
      WINDOW: "15 m",
      PREFIX: "ratelimit:forgot-password:ip:",
    },
    EMAIL: {
      // 5 per hour per email address — prevents flooding one account's inbox
      // even if the attacker funnels through many IPs.
      LIMIT: 5,
      WINDOW: "1 h",
      PREFIX: "ratelimit:forgot-password:email:",
    },
    GLOBAL: {
      // 100 per minute system-wide — protects our transactional email quota.
      LIMIT: 100,
      WINDOW: "1 m",
      PREFIX: "ratelimit:forgot-password:global:",
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/auth/reset-password
  //
  // This route sets the new password after the user is already authenticated
  // via the recovery session. Limits are slightly looser than forgot-password
  // since this step requires a valid reset token to have been clicked first.
  // ─────────────────────────────────────────────────────────────────────
  RESET_PASSWORD: {
    IP: {
      // 5 attempts per 15 minutes — gives room for the user to try different
      // passwords that meet the policy while still blocking automated attempts.
      LIMIT: 5,
      WINDOW: "15 m",
      PREFIX: "ratelimit:reset-password:ip:",
    },
    EMAIL: {
      // 5 per hour per email — consistent with forgot-password email tier.
      LIMIT: 5,
      WINDOW: "1 h",
      PREFIX: "ratelimit:reset-password:email:",
    },
    GLOBAL: {
      // 100 per minute system-wide circuit breaker.
      LIMIT: 100,
      WINDOW: "1 m",
      PREFIX: "ratelimit:reset-password:global:",
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/auth/verify-email
  //
  // This endpoint receives a token-hash link from an email and exchanges
  // it for a session. It does not accept an email in the request body,
  // so only IP + Global tiers are applied.
  //
  // Limits are looser because this is a click-from-email action that
  // users may retry several times (e.g. link opens multiple tabs).
  // ─────────────────────────────────────────────────────────────────────
  VERIFY_EMAIL: {
    IP: {
      // 30 per hour per IP — generous, but still blocks token-bruteforcing bots.
      LIMIT: 30,
      WINDOW: "1 h",
      PREFIX: "ratelimit:verify-email:ip:",
    },
    GLOBAL: {
      // 2000 per hour system-wide — accommodates large user cohorts
      // verifying after a batch invite or marketing campaign.
      LIMIT: 2000,
      WINDOW: "1 h",
      PREFIX: "ratelimit:verify-email:global:",
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/auth/verify-otp
  //
  // OTP verification is token-based (no email input), so only IP + Global
  // tiers are used. Limits mirror verify-email since the UX and threat
  // model are nearly identical.
  // ─────────────────────────────────────────────────────────────────────
  VERIFY_OTP: {
    IP: {
      LIMIT: 30,
      WINDOW: "1 h",
      PREFIX: "ratelimit:verify-otp:ip:",
    },
    GLOBAL: {
      LIMIT: 2000,
      WINDOW: "1 h",
      PREFIX: "ratelimit:verify-otp:global:",
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/auth/set-recovery-session
  //
  // This route exchanges access/refresh tokens (from a recovery email link)
  // for a server-side session cookie. It is a credential-bearing endpoint,
  // so velocity controls are important to prevent token replay attacks.
  // Only IP + Global tiers — no email field in the request body.
  // ─────────────────────────────────────────────────────────────────────
  SET_RECOVERY_SESSION: {
    IP: {
      // 20 per 15 minutes per IP — intentionally higher than forgot-password
      // because a single user might legitimately click the same reset link
      // multiple times across browser tabs.
      LIMIT: 20,
      WINDOW: "15 m",
      PREFIX: "ratelimit:set-recovery-session:ip:",
    },
    GLOBAL: {
      // 1000 per 15 minutes system-wide.
      LIMIT: 1000,
      WINDOW: "15 m",
      PREFIX: "ratelimit:set-recovery-session:global:",
    },
  },
} as const;
