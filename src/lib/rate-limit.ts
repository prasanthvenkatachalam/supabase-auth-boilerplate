/**
 * Rate Limiting Utilities
 * 
 * This module implements industry-standard rate limiting strategies to prevent abuse.
 * We use multiple layers of rate limiting for defense in depth:
 * 
 * 1. IP-based limiting: Prevents single IP from spamming
 * 2. Email-based limiting: Prevents account enumeration and spam with same email
 * 3. Global limiting: Protects overall system resources
 */

import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { redis } from "@/lib/upstash";
import { RATE_LIMIT_CONFIG } from "@/constants/rate-limit";

/**
 * Rate Limiting Strategies:
 * 
 * 1. Sliding Window: Most accurate, prevents burst attacks
 *    - Tracks requests over a continuous time window
 *    - Example: If limit is 5 req/hour, user can't send 5 requests in the first minute
 *      and then 5 more in the next hour
 * 
 * 2. Fixed Window: Simpler, allows burst at window boundaries
 *    - Resets at fixed intervals (e.g., every hour on the hour)
 *    - Slightly less accurate but more performant
 * 
 * 3. Token Bucket: Allows controlled bursts
 *    - Refills tokens at a steady rate
 *    - Good for APIs that need to allow occasional spikes
 */

/**
 * IP-based rate limiter for signup attempts
 * 
 * Configuration:
 * - 3 attempts per 15 minutes per IP
 * - Using sliding window algorithm for accuracy
 * - Prefix "ratelimit:signup:ip:" to organize Redis keys
 * 
 * Why these limits?
 * - 3 attempts: Allows for typos but prevents brute force
 * - 15 minutes: Short enough to prevent abuse, long enough to deter automated attacks
 */
export const ipRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(
    RATE_LIMIT_CONFIG.SIGNUP.IP.LIMIT,
    RATE_LIMIT_CONFIG.SIGNUP.IP.WINDOW as Duration
  ),
  analytics: false,
  prefix: RATE_LIMIT_CONFIG.SIGNUP.IP.PREFIX,
  ephemeralCache: new Map(),
});

export const emailRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(
    RATE_LIMIT_CONFIG.SIGNUP.EMAIL.LIMIT,
    RATE_LIMIT_CONFIG.SIGNUP.EMAIL.WINDOW as Duration
  ),
  analytics: false,
  prefix: RATE_LIMIT_CONFIG.SIGNUP.EMAIL.PREFIX,
  ephemeralCache: new Map(),
});

export const globalSignupRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(
    RATE_LIMIT_CONFIG.SIGNUP.GLOBAL.LIMIT,
    RATE_LIMIT_CONFIG.SIGNUP.GLOBAL.WINDOW as Duration
  ),
  analytics: false,
  prefix: RATE_LIMIT_CONFIG.SIGNUP.GLOBAL.PREFIX,
  ephemeralCache: new Map(),
});

/**
 * Multi-layer rate limit checker for signup
 * 
 * Optimized to check all layers in parallel to minimize latency.
 * Each check is a separate HTTP call to Upstash Redis.
 */
export async function checkSignupRateLimit(
  ip: string,
  email: string
): Promise<{
  allowed: boolean;
  limitType?: "global" | "ip" | "email";
  limit?: number;
  remaining?: number;
  resetAt?: Date;
}> {
  try {
    // Check all layers in parallel to save multiple Round Trip Times (RTT)
    // This is significantly faster than sequential awaits
    const [globalResult, ipResult, emailResult] = await Promise.all([
      globalSignupRateLimiter.limit("global"),
      ipRateLimiter.limit(ip),
      emailRateLimiter.limit(email.toLowerCase()),
    ]);

    // Priority 1: Global limit check
    if (!globalResult.success) {
      return {
        allowed: false,
        limitType: "global",
        limit: globalResult.limit,
        remaining: globalResult.remaining,
        resetAt: new Date(globalResult.reset),
      };
    }

    // Priority 2: IP limit check
    if (!ipResult.success) {
      return {
        allowed: false,
        limitType: "ip",
        limit: ipResult.limit,
        remaining: ipResult.remaining,
        resetAt: new Date(ipResult.reset),
      };
    }

    // Priority 3: Email limit check
    if (!emailResult.success) {
      return {
        allowed: false,
        limitType: "email",
        limit: emailResult.limit,
        remaining: emailResult.remaining,
        resetAt: new Date(emailResult.reset),
      };
    }

    // All checks passed. Return the combined status
    // Use the most restrictive "remaining" count as a guide
    const remaining = Math.min(
      globalResult.remaining,
      ipResult.remaining,
      emailResult.remaining
    );

    // Return current limit and reset from the most relevant limiter (IP)
    return {
      allowed: true,
      limit: ipResult.limit,
      remaining,
      resetAt: new Date(ipResult.reset),
    };
  } catch (error) {
    // Fail open - maintain availability
    console.error("Rate limit check failed:", error);
    return {
      allowed: true,
    };
  }
}

/**
 * Reset rate limits for a specific identifier
 * Useful for testing or customer support scenarios
 * 
 * @param type - Type of rate limit to reset
 * @param identifier - The specific IP or email to reset
 */
export async function resetRateLimit(
  type: "ip" | "email" | "global",
  identifier: string
): Promise<void> {
  const prefix =
    type === "ip"
      ? "ratelimit:signup:ip:"
      : type === "email"
      ? "ratelimit:signup:email:"
      : "ratelimit:signup:global:";

  const key = `${prefix}${identifier}`;
  await redis.del(key);
}

/**
 * Login rate limiters
 * Stricter than signup to prevent brute force attacks
 */
export const ipLoginRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(
    RATE_LIMIT_CONFIG.LOGIN.IP.LIMIT,
    RATE_LIMIT_CONFIG.LOGIN.IP.WINDOW as Duration
  ),
  analytics: false,
  prefix: RATE_LIMIT_CONFIG.LOGIN.IP.PREFIX,
  ephemeralCache: new Map(),
});

export const emailLoginRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(
    RATE_LIMIT_CONFIG.LOGIN.EMAIL.LIMIT,
    RATE_LIMIT_CONFIG.LOGIN.EMAIL.WINDOW as Duration
  ),
  analytics: false,
  prefix: RATE_LIMIT_CONFIG.LOGIN.EMAIL.PREFIX,
  ephemeralCache: new Map(),
});

export const globalLoginRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(
    RATE_LIMIT_CONFIG.LOGIN.GLOBAL.LIMIT,
    RATE_LIMIT_CONFIG.LOGIN.GLOBAL.WINDOW as Duration
  ),
  analytics: false,
  prefix: RATE_LIMIT_CONFIG.LOGIN.GLOBAL.PREFIX,
  ephemeralCache: new Map(),
});

/**
 * Check rate limits for login
 * 
 * Parallelized for performance.
 * 
 * @param ip - Client IP
 * @param email - User email
 */
export async function checkLoginRateLimit(
  ip: string,
  email: string
): Promise<{
  allowed: boolean;
  limitType?: "global" | "ip" | "email";
  limit?: number;
  remaining?: number;
  resetAt?: Date;
}> {
  try {
    const [globalResult, ipResult, emailResult] = await Promise.all([
      globalLoginRateLimiter.limit("global"),
      ipLoginRateLimiter.limit(ip),
      emailLoginRateLimiter.limit(email.toLowerCase()),
    ]);

    if (!globalResult.success) {
      return {
        allowed: false,
        limitType: "global",
        limit: globalResult.limit,
        remaining: globalResult.remaining,
        resetAt: new Date(globalResult.reset),
      };
    }

    if (!ipResult.success) {
      return {
        allowed: false,
        limitType: "ip",
        limit: ipResult.limit,
        remaining: ipResult.remaining,
        resetAt: new Date(ipResult.reset),
      };
    }

    if (!emailResult.success) {
      return {
        allowed: false,
        limitType: "email",
        limit: emailResult.limit,
        remaining: emailResult.remaining,
        resetAt: new Date(emailResult.reset),
      };
    }

    return {
      allowed: true,
      remaining: Math.min(
        globalResult.remaining,
        ipResult.remaining,
        emailResult.remaining
      ),
      limit: emailResult.limit, // Most specific limit
      resetAt: new Date(emailResult.reset),
    };
  } catch (error) {
    console.error("Login rate limit check failed:", error);
    return { allowed: true };
  }
}

/**
 * Resend verification email rate limiters
 * Prevents abuse of resend functionality
 */
export const ipResendVerificationRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(
    RATE_LIMIT_CONFIG.RESEND_VERIFICATION.IP.LIMIT,
    RATE_LIMIT_CONFIG.RESEND_VERIFICATION.IP.WINDOW as Duration
  ),
  analytics: false,
  prefix: RATE_LIMIT_CONFIG.RESEND_VERIFICATION.IP.PREFIX,
  ephemeralCache: new Map(),
});

export const emailResendVerificationRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(
    RATE_LIMIT_CONFIG.RESEND_VERIFICATION.EMAIL.LIMIT,
    RATE_LIMIT_CONFIG.RESEND_VERIFICATION.EMAIL.WINDOW as Duration
  ),
  analytics: false,
  prefix: RATE_LIMIT_CONFIG.RESEND_VERIFICATION.EMAIL.PREFIX,
  ephemeralCache: new Map(),
});

export const globalResendVerificationRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(
    RATE_LIMIT_CONFIG.RESEND_VERIFICATION.GLOBAL.LIMIT,
    RATE_LIMIT_CONFIG.RESEND_VERIFICATION.GLOBAL.WINDOW as Duration
  ),
  analytics: false,
  prefix: RATE_LIMIT_CONFIG.RESEND_VERIFICATION.GLOBAL.PREFIX,
  ephemeralCache: new Map(),
});

/**
 * Check rate limits for resend verification email
 * 
 * @param ip - Client IP
 * @param email - User email
 */
export async function checkResendVerificationRateLimit(
  ip: string,
  email: string
): Promise<{
  allowed: boolean;
  limitType?: "global" | "ip" | "email";
  limit?: number;
  remaining?: number;
  resetAt?: Date;
}> {
  try {
    const [globalResult, ipResult, emailResult] = await Promise.all([
      globalResendVerificationRateLimiter.limit("global"),
      ipResendVerificationRateLimiter.limit(ip),
      emailResendVerificationRateLimiter.limit(email.toLowerCase()),
    ]);

    if (!globalResult.success) {
      return {
        allowed: false,
        limitType: "global",
        limit: globalResult.limit,
        remaining: globalResult.remaining,
        resetAt: new Date(globalResult.reset),
      };
    }

    if (!ipResult.success) {
      return {
        allowed: false,
        limitType: "ip",
        limit: ipResult.limit,
        remaining: ipResult.remaining,
        resetAt: new Date(ipResult.reset),
      };
    }

    if (!emailResult.success) {
      return {
        allowed: false,
        limitType: "email",
        limit: emailResult.limit,
        remaining: emailResult.remaining,
        resetAt: new Date(emailResult.reset),
      };
    }

    return {
      allowed: true,
      remaining: Math.min(
        globalResult.remaining,
        ipResult.remaining,
        emailResult.remaining
      ),
      limit: emailResult.limit,
      resetAt: new Date(emailResult.reset),
    };
  } catch (error) {
    console.error("Resend verification rate limit check failed:", error);
    return { allowed: true };
  }
}

/**
 * Forgot password rate limiters
 * Uses the same limits as signup to prevent abuse
 */
export const ipForgotPasswordRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(
    RATE_LIMIT_CONFIG.FORGOT_PASSWORD.IP.LIMIT,
    RATE_LIMIT_CONFIG.FORGOT_PASSWORD.IP.WINDOW as Duration
  ),
  analytics: false,
  prefix: RATE_LIMIT_CONFIG.FORGOT_PASSWORD.IP.PREFIX,
  ephemeralCache: new Map(),
});

export const emailForgotPasswordRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(
    RATE_LIMIT_CONFIG.FORGOT_PASSWORD.EMAIL.LIMIT,
    RATE_LIMIT_CONFIG.FORGOT_PASSWORD.EMAIL.WINDOW as Duration
  ),
  analytics: false,
  prefix: RATE_LIMIT_CONFIG.FORGOT_PASSWORD.EMAIL.PREFIX,
  ephemeralCache: new Map(),
});

export const globalForgotPasswordRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(
    RATE_LIMIT_CONFIG.FORGOT_PASSWORD.GLOBAL.LIMIT,
    RATE_LIMIT_CONFIG.FORGOT_PASSWORD.GLOBAL.WINDOW as Duration
  ),
  analytics: false,
  prefix: RATE_LIMIT_CONFIG.FORGOT_PASSWORD.GLOBAL.PREFIX,
  ephemeralCache: new Map(),
});

/**
 * Check rate limits for forgot password
 * 
 * @param ip - Client IP
 * @param email - User email
 */
export async function checkForgotPasswordRateLimit(
  ip: string,
  email: string
): Promise<{
  allowed: boolean;
  limitType?: "global" | "ip" | "email";
  limit?: number;
  remaining?: number;
  resetAt?: Date;
}> {
  try {
    const [globalResult, ipResult, emailResult] = await Promise.all([
      globalForgotPasswordRateLimiter.limit("global"),
      ipForgotPasswordRateLimiter.limit(ip),
      emailForgotPasswordRateLimiter.limit(email.toLowerCase()),
    ]);

    if (!globalResult.success) {
      return {
        allowed: false,
        limitType: "global",
        limit: globalResult.limit,
        remaining: globalResult.remaining,
        resetAt: new Date(globalResult.reset),
      };
    }

    if (!ipResult.success) {
      return {
        allowed: false,
        limitType: "ip",
        limit: ipResult.limit,
        remaining: ipResult.remaining,
        resetAt: new Date(ipResult.reset),
      };
    }

    if (!emailResult.success) {
      return {
        allowed: false,
        limitType: "email",
        limit: emailResult.limit,
        remaining: emailResult.remaining,
        resetAt: new Date(emailResult.reset),
      };
    }

    return {
      allowed: true,
      remaining: Math.min(
        globalResult.remaining,
        ipResult.remaining,
        emailResult.remaining
      ),
      limit: emailResult.limit,
      resetAt: new Date(emailResult.reset),
    };
  } catch (error) {
    console.error("Forgot password rate limit check failed:", error);
    return { allowed: true };
  }
}

/**
 * Update password rate limiters
 * Uses the same limits as signup to prevent abuse
 */
export const ipUpdatePasswordRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(
    RATE_LIMIT_CONFIG.UPDATE_PASSWORD.IP.LIMIT,
    RATE_LIMIT_CONFIG.UPDATE_PASSWORD.IP.WINDOW as Duration
  ),
  analytics: false,
  prefix: RATE_LIMIT_CONFIG.UPDATE_PASSWORD.IP.PREFIX,
  ephemeralCache: new Map(),
});

export const emailUpdatePasswordRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(
    RATE_LIMIT_CONFIG.UPDATE_PASSWORD.EMAIL.LIMIT,
    RATE_LIMIT_CONFIG.UPDATE_PASSWORD.EMAIL.WINDOW as Duration
  ),
  analytics: false,
  prefix: RATE_LIMIT_CONFIG.UPDATE_PASSWORD.EMAIL.PREFIX,
  ephemeralCache: new Map(),
});

export const globalUpdatePasswordRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(
    RATE_LIMIT_CONFIG.UPDATE_PASSWORD.GLOBAL.LIMIT,
    RATE_LIMIT_CONFIG.UPDATE_PASSWORD.GLOBAL.WINDOW as Duration
  ),
  analytics: false,
  prefix: RATE_LIMIT_CONFIG.UPDATE_PASSWORD.GLOBAL.PREFIX,
  ephemeralCache: new Map(),
});

/**
 * Check rate limits for update password
 * 
 * @param ip - Client IP
 * @param email - User email
 */
export async function checkUpdatePasswordRateLimit(
  ip: string,
  email: string
): Promise<{
  allowed: boolean;
  limitType?: "global" | "ip" | "email";
  limit?: number;
  remaining?: number;
  resetAt?: Date;
}> {
  try {
    const [globalResult, ipResult, emailResult] = await Promise.all([
      globalUpdatePasswordRateLimiter.limit("global"),
      ipUpdatePasswordRateLimiter.limit(ip),
      emailUpdatePasswordRateLimiter.limit(email.toLowerCase()),
    ]);

    if (!globalResult.success) {
      return {
        allowed: false,
        limitType: "global",
        limit: globalResult.limit,
        remaining: globalResult.remaining,
        resetAt: new Date(globalResult.reset),
      };
    }

    if (!ipResult.success) {
      return {
        allowed: false,
        limitType: "ip",
        limit: ipResult.limit,
        remaining: ipResult.remaining,
        resetAt: new Date(ipResult.reset),
      };
    }

    if (!emailResult.success) {
      return {
        allowed: false,
        limitType: "email",
        limit: emailResult.limit,
        remaining: emailResult.remaining,
        resetAt: new Date(emailResult.reset),
      };
    }

    return {
      allowed: true,
      remaining: Math.min(
        globalResult.remaining,
        ipResult.remaining,
        emailResult.remaining
      ),
      limit: emailResult.limit,
      resetAt: new Date(emailResult.reset),
    };
  } catch (error) {
    console.error("Update password rate limit check failed:", error);
    return { allowed: true };
  }
}
