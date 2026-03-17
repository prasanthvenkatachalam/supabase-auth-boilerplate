/**
 * Forgot Password API Route with Rate Limiting
 *
 * This endpoint handles password reset requests with multiple layers of protection:
 * 1. Rate limiting (IP, email, and global) - same limits as signup
 * 2. Input validation using Zod
 * 3. Supabase Admin to generate reset link
 * 4. Background email sending via Zepto Mail
 *
 * Architecture decisions:
 * - Using Next.js API Routes for server-side processing
 * - Rate limiting happens BEFORE database queries to protect resources
 * - Always returns success to prevent email enumeration attacks
 * - Background email sending for faster response times
 */

import { NextRequest, NextResponse, after } from "next/server";
import { forgotPasswordSchema } from "@/lib/validations/auth";
import { checkForgotPasswordRateLimit } from "@/lib/rate-limit";
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from "@/constants/messages";
import { ROUTES } from "@/constants";
import { routing } from "@/i18n/routing";
import { RATE_LIMIT_CONFIG } from "@/constants/rate-limit";
import { sendEmail } from "@/lib/mail";
import { validateTurnstileToken } from "@/lib/turnstile";
import { supabaseAdmin } from "@/utils/supabase/admin";

export const runtime = "nodejs";

/**
 * Helper function to extract client IP address
 * Same implementation as signup route
 */
function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const ips = forwardedFor.split(",").map((ip) => ip.trim());
    return ips[0];
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  return "127.0.0.1";
}

/**
 * POST /api/auth/forgot-password
 *
 * Request body:
 * {
 *   "email": "user@example.com",
 *   "redirectTo": "https://example.com/auth/update-password" (optional)
 * }
 *
 * Response codes:
 * - 200: Request processed (always returns success to prevent enumeration)
 * - 400: Invalid input (validation failed)
 * - 429: Rate limit exceeded
 * - 500: Server error
 */
export async function POST(request: NextRequest) {
  try {
    // Step 1: Parse request body
    const bodyPromise = request.json();

    // Step 2: Get client IP
    const clientIp = getClientIp(request);

    // Step 3: Await Body & Validate
    const body = await bodyPromise;

    const validationResult = forgotPasswordSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: ERROR_MESSAGES.VALIDATION.INVALID_INPUT,
          details: validationResult.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const { email, redirectTo: redirectToRaw } = validationResult.data;
    const baseUrl = new URL(request.url);
    const defaultRedirect = `${baseUrl.origin}/${routing.defaultLocale}${ROUTES.AUTH.CONFIRM}?type=recovery`;

    let redirectTo: string;
    if (redirectToRaw) {
      try {
        const resolved = new URL(redirectToRaw, request.url);
        if (resolved.origin !== baseUrl.origin) {
          redirectTo = defaultRedirect;
        } else {
          redirectTo = resolved.toString();
        }
      } catch {
        redirectTo = defaultRedirect;
      }
    } else {
      redirectTo = defaultRedirect;
    }

    // Step 4: Check Rate Limits
    console.time("rate-limit-check");
    const rateLimitResult = await checkForgotPasswordRateLimit(clientIp, email);
    console.timeEnd("rate-limit-check");

    if (!rateLimitResult.allowed) {
      const resetDate = rateLimitResult.resetAt;
      const retryAfterSeconds = resetDate
        ? Math.ceil((resetDate.getTime() - Date.now()) / 1000)
        : 900;

      const limitType = rateLimitResult.limitType || "global";
      const messageMap: Record<string, string> = {
        global: ERROR_MESSAGES.RATE_LIMIT.GLOBAL,
        ip: ERROR_MESSAGES.RATE_LIMIT.IP,
        email: ERROR_MESSAGES.RATE_LIMIT.EMAIL,
      };

      return NextResponse.json(
        {
          error: ERROR_MESSAGES.RATE_LIMIT.GENERIC,
          message: messageMap[limitType],
          retryAfter: retryAfterSeconds,
          limit: rateLimitResult.limit,
          remaining: rateLimitResult.remaining,
        },
        {
          status: 429,
          headers: {
            "Retry-After": retryAfterSeconds.toString(),
            "X-RateLimit-Limit": rateLimitResult.limit?.toString() || "0",
            "X-RateLimit-Remaining": rateLimitResult.remaining?.toString() || "0",
            "X-RateLimit-Reset": resetDate?.getTime().toString() || "",
          },
        },
      );
    }

    // Step 5: Validate Turnstile Token
    // Check captcha after rate limit to protect the verification API,
    // but before expensive operations (though rate limit check is cheap).
    // Actually, validating captcha first acts as a better filter against bots?
    // But then we hit Cloudflare API on every request.
    // Let's stick to Rate Limit -> Captcha -> Logic.
    const { captchaToken } = validationResult.data;
    const captchaValidation = await validateTurnstileToken(captchaToken, clientIp);

    if (!captchaValidation.success) {
      return NextResponse.json(
        {
          error: "Captcha Validation Failed",
          message: captchaValidation.error || "Please complete the captcha correctly.",
        },
        { status: 400 },
      );
    }

    // Step 5: Generate Password Reset Link (using Admin API)
    // We use admin API to generate the link and send email ourselves
    // This gives us more control over the email template
    console.time("admin-generate-link");

    const { data: adminData, error: adminError } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: {
        redirectTo,
      },
    });
    console.timeEnd("admin-generate-link");

    // Note: We always return success to prevent email enumeration
    // Even if the user doesn't exist, we don't want to reveal that
    if (adminError) {
      // Log the error but don't expose it to the client
      console.error("Generate recovery link error:", adminError);
      // Still return success to prevent enumeration
      return NextResponse.json(
        {
          success: true,
          message: SUCCESS_MESSAGES.FORGOT_PASSWORD.EMAIL_SENT,
        },
        {
          status: 200,
          headers: {
            "X-RateLimit-Limit": rateLimitResult.limit?.toString() || "0",
            "X-RateLimit-Remaining": rateLimitResult.remaining?.toString() || "0",
            "X-RateLimit-Reset": rateLimitResult.resetAt?.getTime().toString() || "",
          },
        },
      );
    }

    // Step 6: Background Email Sending
    after(async () => {
      // Use hashed_token to build a PKCE-compatible link that points directly
      // to our /auth/confirm route (token_hash + type in query params).
      // This avoids Supabase's /auth/v1/verify endpoint which uses the implicit
      // flow (hash fragments) — incompatible with @supabase/ssr PKCE mode.
      const hashedToken = adminData.properties?.hashed_token;
      if (!hashedToken) {
        console.error("[Background] Failed to generate recovery link for", email);
        return;
      }
      const recoveryLink = `${baseUrl.origin}/${routing.defaultLocale}${ROUTES.AUTH.CONFIRM}?token_hash=${encodeURIComponent(hashedToken)}&type=recovery`;

      console.time(`email-send-${email}`);
      const emailResult = await sendEmail({
        to: email,
        subject: "Reset your password",
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: #333;">Reset Your Password</h2>
            <p>We received a request to reset your password. Click the button below to create a new password.</p>
            <div style="margin: 30px 0;">
              <a href="${recoveryLink}" style="background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
            </div>
            <p style="color: #666; font-size: 14px;">If the button doesn't work, you can copy and paste this link into your browser:</p>
            <p style="color: #666; font-size: 14px; word-break: break-all;">${recoveryLink}</p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #999; font-size: 12px;">If you didn't request a password reset, you can safely ignore this email. Your password will not be changed.</p>
          </div>
        `,
      });
      console.timeEnd(`email-send-${email}`);

      if (!emailResult.success) {
        console.error("[Background] Failed to send recovery email to", email, emailResult.error);
      } else {
        console.log("[Background] Recovery email sent successfully to", email);
      }
    });

    // Step 7: Immediate Success Response
    return NextResponse.json(
      {
        success: true,
        message: SUCCESS_MESSAGES.FORGOT_PASSWORD.EMAIL_SENT,
      },
      {
        status: 200,
        headers: {
          "X-RateLimit-Limit": rateLimitResult.limit?.toString() || "0",
          "X-RateLimit-Remaining": rateLimitResult.remaining?.toString() || "0",
          "X-RateLimit-Reset": rateLimitResult.resetAt?.getTime().toString() || "",
        },
      },
    );
  } catch (error) {
    console.error("Unexpected error in forgot-password route:", error);

    return NextResponse.json(
      {
        error: "Internal Server Error",
        message: ERROR_MESSAGES.AUTH.INTERNAL_ERROR,
      },
      { status: 500 },
    );
  }
}

/**
 * GET /api/auth/forgot-password
 *
 * Returns information about forgot-password rate limits
 */
export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);

  return NextResponse.json({
    message: "Forgot password endpoint",
    rateLimit: {
      ip: {
        limit: RATE_LIMIT_CONFIG.FORGOT_PASSWORD.IP.LIMIT,
        window: RATE_LIMIT_CONFIG.FORGOT_PASSWORD.IP.WINDOW,
      },
      email: {
        limit: RATE_LIMIT_CONFIG.FORGOT_PASSWORD.EMAIL.LIMIT,
        window: RATE_LIMIT_CONFIG.FORGOT_PASSWORD.EMAIL.WINDOW,
      },
      global: {
        limit: RATE_LIMIT_CONFIG.FORGOT_PASSWORD.GLOBAL.LIMIT,
        window: RATE_LIMIT_CONFIG.FORGOT_PASSWORD.GLOBAL.WINDOW,
      },
    },
    clientIp,
  });
}
