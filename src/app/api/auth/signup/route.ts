/**
 * Signup API Route with Rate Limiting
 * 
 * This endpoint handles user registration with multiple layers of protection:
 * 1. Rate limiting (IP, email, and global)
 * 2. Input validation using Zod
 * 3. Supabase Auth integration
 * 4. Profile row created in this route (no DB trigger)
 * 
 * Architecture decisions:
 * - Using Next.js API Routes for server-side processing
 * - Rate limiting happens BEFORE database queries to protect resources
 * - Returns detailed error messages for better UX
 * - Follows REST conventions (POST for creation, proper status codes)
 */

import { NextRequest, NextResponse, after } from "next/server";
import { signUpSchema } from "@/lib/validations/auth";
import { checkSignupRateLimit } from "@/lib/rate-limit";
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from "@/constants/messages";
import { RATE_LIMIT_CONFIG } from "@/constants/rate-limit";
import { sendEmail } from "@/lib/mail";

import { supabaseAdmin } from "@/utils/supabase/admin";

export const runtime = 'nodejs';

/**
 * Helper function to extract client IP address
 * 
 * Checks multiple headers in order of preference:
 * 1. x-forwarded-for: Set by proxies/load balancers (Vercel, AWS, etc.)
 * 2. x-real-ip: Alternative header used by some proxies (Nginx)
 * 3. Remote address from connection
 * 
 * Returns first valid IP found
 * 
 * Security note: In production, ensure your hosting platform sets these headers correctly
 * to prevent IP spoofing
 */
function getClientIp(request: NextRequest): string {
  // x-forwarded-for can contain multiple IPs (client, proxy1, proxy2)
  // We want the first one (the original client)
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const ips = forwardedFor.split(",").map((ip) => ip.trim());
    return ips[0];
  }

  // Fallback to x-real-ip
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  // Last resort: use a placeholder (shouldn't happen in production)
  // In local development, this will be used
  return "127.0.0.1";
}

/**
 * POST /api/auth/signup
 * 
 * Request body:
 * {
 *   "email": "user@example.com",
 *   "password": "SecurePassword123!"
 * }
 * 
 * Response codes:
 * - 201: User created successfully
 * - 400: Invalid input (validation failed)
 * - 429: Rate limit exceeded
 * - 409: Email already exists
 * - 500: Server error
 */
export async function POST(request: NextRequest) {
  try {
    // Step 1: Start async tasks immediately (Parallel Execution)
    // Kick off body parsing
    const bodyPromise = request.json();
    
    // Step 2: Get client IP (Sync)
    const clientIp = getClientIp(request);

    // Step 3: Await Body & Validate
    const body = await bodyPromise;
    
    const validationResult = signUpSchema.safeParse(body);
    
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: ERROR_MESSAGES.VALIDATION.INVALID_INPUT,
          details: validationResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { email, password } = validationResult.data;

    // Step 4: Start Rate Limit Check
    console.time("rate-limit-check");
    const rateLimitResult = await checkSignupRateLimit(clientIp, email);
    console.timeEnd("rate-limit-check");

    if (!rateLimitResult.allowed) {
      // Rate limit exceeded - return 429 with retry information
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
        }
      );
    }

    // Step 5: Fast Signup (Non-blocking Email)
    console.time("admin-generate-link");
    const { data: adminData, error: adminError } = await supabaseAdmin.auth.admin.generateLink({
      type: "signup",
      email,
      password,
      options: {
        data: {
          // You can add additional metadata here
        },
      },
    });
    console.timeEnd("admin-generate-link");

    if (adminError) {
      if (adminError.message.includes("already registered")) {
        return NextResponse.json(
          { error: "Conflict", message: ERROR_MESSAGES.AUTH.EMAIL_EXISTS },
          { status: 409 }
        );
      }
      console.error("[signup] generateLink error:", adminError);
      const isDev = process.env.NODE_ENV === "development";
      return NextResponse.json(
        {
          error: ERROR_MESSAGES.AUTH.SIGNUP_FAILED,
          message: isDev ? adminError.message : ERROR_MESSAGES.AUTH.INTERNAL_ERROR,
        },
        { status: 500 }
      );
    }

    // Step 5b: Create profile row (service role; no trigger)
    const user = adminData.user;
    if (user?.id) {
      const now = new Date().toISOString();
      const { error: profileError } = await supabaseAdmin.from("profiles").upsert(
        {
          id: user.id,
          email: user.email ?? email,
          full_name: user.user_metadata?.full_name ?? null,
          avatar_url: user.user_metadata?.avatar_url ?? null,
          created_at: now,
          updated_at: now,
        },
        { onConflict: "id" }
      );
      if (profileError) {
        console.error("[signup] profile upsert error:", profileError);
        const isDev = process.env.NODE_ENV === "development";
        return NextResponse.json(
          {
            error: ERROR_MESSAGES.AUTH.SIGNUP_FAILED,
            message: isDev ? profileError.message : ERROR_MESSAGES.AUTH.INTERNAL_ERROR,
          },
          { status: 500 }
        );
      }
    }

    // Step 6: Background Email Sending (Zepto Mail)
    after(async () => {
      const verificationLink = adminData.properties?.action_link;
      if (!verificationLink) {
        console.error("[Background] Failed to generate verification link for", email);
        return;
      }

      console.time(`email-send-${email}`);
      const emailResult = await sendEmail({
        to: email,
        subject: "Verify your email address",
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: #333;">Welcome to our platform!</h2>
            <p>Please click the button below to verify your email address and complete your registration.</p>
            <div style="margin: 30px 0;">
              <a href="${verificationLink}" style="background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Verify Email Address</a>
            </div>
            <p style="color: #666; font-size: 14px;">If the button doesn't work, you can copy and paste this link into your browser:</p>
            <p style="color: #666; font-size: 14px; word-break: break-all;">${verificationLink}</p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #999; font-size: 12px;">If you didn't create an account, you can safely ignore this email.</p>
          </div>
        `,
      });
      console.timeEnd(`email-send-${email}`);

      if (!emailResult.success) {
        console.error("[Background] Failed to send verification email to", email, emailResult.error);
      } else {
        console.log("[Background] Verification email sent successfully to", email);
      }
    });

    // Step 7: Immediate Success Response
    return NextResponse.json(
      {
        success: true,
        message: SUCCESS_MESSAGES.SIGNUP.CREATED,
        user: {
          id: adminData.user?.id,
          email: adminData.user?.email,
        },
      },
      {
        status: 201,
        headers: {
          "X-RateLimit-Limit": rateLimitResult.limit?.toString() || "0",
          "X-RateLimit-Remaining": rateLimitResult.remaining?.toString() || "0",
          "X-RateLimit-Reset": rateLimitResult.resetAt?.getTime().toString() || "",
        },
      }
    );
  } catch (error) {
    console.error("[signup] unexpected error:", error);
    const isDev = process.env.NODE_ENV === "development";
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: ERROR_MESSAGES.AUTH.SIGNUP_FAILED,
        message: isDev ? message : ERROR_MESSAGES.AUTH.INTERNAL_ERROR,
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/auth/signup
 * 
 * Returns information about signup rate limits
 * Useful for displaying rate limit status to users
 */
export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);
  
  return NextResponse.json({
    message: "Signup endpoint",
    rateLimit: {
      ip: {
        limit: RATE_LIMIT_CONFIG.SIGNUP.IP.LIMIT,
        window: RATE_LIMIT_CONFIG.SIGNUP.IP.WINDOW,
      },
      email: {
        limit: RATE_LIMIT_CONFIG.SIGNUP.EMAIL.LIMIT,
        window: RATE_LIMIT_CONFIG.SIGNUP.EMAIL.WINDOW,
      },
      global: {
        limit: RATE_LIMIT_CONFIG.SIGNUP.GLOBAL.LIMIT,
        window: RATE_LIMIT_CONFIG.SIGNUP.GLOBAL.WINDOW,
      },
    },
    clientIp, // Return for debugging (remove in production)
  });
}
