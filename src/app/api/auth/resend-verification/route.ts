/**
 * Resend Verification Email API Route
 * 
 * This endpoint handles resending verification emails with rate limiting.
 * It prevents abuse while allowing legitimate users to request new verification emails.
 */

import { NextRequest, NextResponse, after } from "next/server";
import { checkResendVerificationRateLimit } from "@/lib/rate-limit";
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from "@/constants/messages";
import { RATE_LIMIT_CONFIG } from "@/constants/rate-limit";
import { sendEmail } from "@/lib/mail";
import { supabaseAdmin } from "@/utils/supabase/admin";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";

export const runtime = 'nodejs';

/**
 * Email validation schema
 */
const resendVerificationSchema = z.object({
  email: z.string().email("Invalid email address"),
});

/**
 * Helper function to extract client IP address
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
 * Find a user by email using listUsers (Admin API has no getUserByEmail).
 * Paginates until the user is found or no more pages.
 */
async function findUserByEmail(email: string): Promise<{
  data: { user: User | null };
  error: Error | null;
}> {
  const normalizedEmail = email.toLowerCase().trim();
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) return { data: { user: null }, error };
    const user = data.users.find(
      (u) => u.email?.toLowerCase().trim() === normalizedEmail
    );
    if (user) return { data: { user }, error: null };
    if (data.users.length < perPage) break;
    page += 1;
  }
  return { data: { user: null }, error: null };
}

/**
 * POST /api/auth/resend-verification
 * 
 * Request body:
 * {
 *   "email": "user@example.com"
 * }
 * 
 * Response codes:
 * - 200: Verification email sent successfully
 * - 400: Invalid email or validation error
 * - 404: User not found
 * - 409: Email already verified
 * - 429: Rate limit exceeded
 * - 500: Server error
 */
export async function POST(request: NextRequest) {
  try {
    // Step 1: Get client IP
    const clientIp = getClientIp(request);

    // Step 2: Parse and validate request body
    const body = await request.json();
    const validationResult = resendVerificationSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: "validation_error",
          message: "Invalid email address",
          details: validationResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { email } = validationResult.data;

    // Step 3: Check rate limits
    const rateLimitResult = await checkResendVerificationRateLimit(
      clientIp,
      email
    );

    if (!rateLimitResult.allowed) {
      const resetDate = rateLimitResult.resetAt;
      const retryAfterSeconds = resetDate
        ? Math.ceil((resetDate.getTime() - Date.now()) / 1000)
        : 3600;

      const limitType = rateLimitResult.limitType || "global";
      const messageMap: Record<string, string> = {
        global: "Too many requests. Please try again later.",
        ip: "Too many requests from your network. Please try again later.",
        email: "Too many resend requests for this email. Please try again later.",
      };

      return NextResponse.json(
        {
          success: false,
          error: "rate_limit_exceeded",
          message: messageMap[limitType] || "Too many requests. Please try again later.",
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

    // Step 4: Check if user exists and get user status
    const { data: userData, error: userError } =
      await findUserByEmail(email);

    if (userError || !userData?.user) {
      // Don't reveal if email exists or not (security best practice)
      // Return success even if user doesn't exist to prevent email enumeration
      return NextResponse.json(
        {
          success: true,
          message: "If an account exists with this email, a verification email has been sent.",
        },
        { status: 200 }
      );
    }

    const user = userData.user;

    // Step 5: Check if email is already verified
    if (user.email_confirmed_at) {
      return NextResponse.json(
        {
          success: false,
          error: "already_verified",
          message: "This email is already verified. You can log in now.",
        },
        { status: 409 }
      );
    }

    // Step 6: Generate new verification link
    // Note: redirectTo is optional - Supabase will use the default callback URL
    // configured in the project settings, which should point to /auth/confirm
    const { data: adminData, error: adminError } =
      await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });

    if (adminError) {
      console.error("Generate link error:", adminError);
      return NextResponse.json(
        {
          success: false,
          error: "generation_failed",
          message: "Failed to generate verification link. Please try again later.",
        },
        { status: 500 }
      );
    }

    // Step 7: Send email in background
    after(async () => {
      const verificationLink = adminData.properties?.action_link;
      if (!verificationLink) {
        console.error(
          "[Background] Failed to generate verification link for",
          email
        );
        return;
      }

      const emailResult = await sendEmail({
        to: email,
        subject: "Verify your email address",
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: #333;">Verify your email address</h2>
            <p>Please click the button below to verify your email address and complete your registration.</p>
            <div style="margin: 30px 0;">
              <a href="${verificationLink}" style="background-color: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Verify Email Address</a>
            </div>
            <p style="color: #666; font-size: 14px;">If the button doesn't work, you can copy and paste this link into your browser:</p>
            <p style="color: #666; font-size: 14px; word-break: break-all;">${verificationLink}</p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #999; font-size: 12px;">If you didn't request this email, you can safely ignore it.</p>
          </div>
        `,
      });

      if (!emailResult.success) {
        console.error(
          "[Background] Failed to send verification email to",
          email,
          emailResult.error
        );
      } else {
        console.log(
          "[Background] Verification email sent successfully to",
          email
        );
      }
    });

    // Step 8: Return success response
    return NextResponse.json(
      {
        success: true,
        message: "Verification email sent! Please check your inbox.",
      },
      {
        status: 200,
        headers: {
          "X-RateLimit-Limit": rateLimitResult.limit?.toString() || "0",
          "X-RateLimit-Remaining": rateLimitResult.remaining?.toString() || "0",
          "X-RateLimit-Reset": rateLimitResult.resetAt?.getTime().toString() || "",
        },
      }
    );
  } catch (error) {
    console.error("Unexpected error in resend-verification route:", error);
    return NextResponse.json(
      {
        success: false,
        error: "internal_error",
        message: "An unexpected error occurred. Please try again later.",
      },
      { status: 500 }
    );
  }
}
