/**
 * Email Verification API Route
 * 
 * This endpoint handles email verification when users click the verification link.
 * It provides structured error responses for different scenarios:
 * - Success: Email verified
 * - Expired: Token has expired
 * - Invalid: Token is invalid or malformed
 * - Already verified: Email was already verified
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { supabaseAdmin } from "@/utils/supabase/admin";
import { type EmailOtpType } from "@supabase/supabase-js";
import { getClientIp } from "@/lib/client-ip";
import { checkVerifyEmailRateLimit } from "@/lib/rate-limit";

export const runtime = 'nodejs';

const ALLOWED_VERIFY_EMAIL_TYPES: readonly EmailOtpType[] = ["signup", "email", "invite", "magiclink", "recovery"] as const;

function isAllowedVerifyEmailType(value: string | null): value is EmailOtpType {
  return value !== null && (ALLOWED_VERIFY_EMAIL_TYPES as readonly string[]).includes(value);
}

/**
 * GET /api/auth/verify-email
 * 
 * Query parameters:
 * - token_hash: The verification token from the email link
 * - type: The OTP type (usually "signup" or "email")
 * 
 * Response codes:
 * - 200: Email verified successfully
 * - 400: Invalid token or missing parameters
 * - 410: Token expired
 * - 409: Email already verified
 * - 500: Server error
 */
export async function GET(request: NextRequest) {
  try {
    const clientIp = getClientIp(request);
    const rateLimitResult = await checkVerifyEmailRateLimit(clientIp);

    if (!rateLimitResult.allowed) {
      const retryAfterSeconds = rateLimitResult.resetAt
        ? Math.max(1, Math.ceil((rateLimitResult.resetAt.getTime() - Date.now()) / 1000))
        : 3600;

      return NextResponse.json(
        {
          success: false,
          error: "rate_limited",
          message: "Too many verification attempts. Please try again later.",
          retryAfter: retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            "Retry-After": retryAfterSeconds.toString(),
            "X-RateLimit-Limit": rateLimitResult.limit?.toString() ?? "0",
            "X-RateLimit-Remaining": rateLimitResult.remaining?.toString() ?? "0",
            "X-RateLimit-Reset": rateLimitResult.resetAt?.getTime().toString() ?? "",
          },
        }
      );
    }

    const { searchParams } = new URL(request.url);
    const token_hash = searchParams.get("token_hash");
    const typeRaw = searchParams.get("type");

    // Validate required parameters
    if (!token_hash || !isAllowedVerifyEmailType(typeRaw)) {
      return NextResponse.json(
        {
          success: false,
          error: "invalid",
          message: "Missing verification token or type",
        },
        { status: 400 }
      );
    }

    const type: EmailOtpType = typeRaw;

    const supabase = await createClient();

    // Attempt to verify the OTP
    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });

    // Handle verification errors
    if (error) {
      // Check for specific error types
      const errorMessage = error.message.toLowerCase();

      // Token expired
      if (
        errorMessage.includes("expired") ||
        errorMessage.includes("token has expired") ||
        errorMessage.includes("link has expired")
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "expired",
            message: "This verification link has expired. Please request a new one.",
          },
          { status: 410 }
        );
      }

      // Already verified
      if (
        errorMessage.includes("already") ||
        errorMessage.includes("confirmed") ||
        errorMessage.includes("verified")
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "already_verified",
            message: "Your email is already verified. You can log in now.",
          },
          { status: 409 }
        );
      }

      // Invalid token
      if (
        errorMessage.includes("invalid") ||
        errorMessage.includes("not found") ||
        errorMessage.includes("malformed")
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "invalid",
            message: "Invalid verification link. Please request a new one.",
          },
          { status: 400 }
        );
      }

      // Generic error
      return NextResponse.json(
        {
          success: false,
          error: "verification_failed",
          message: error.message || "Email verification failed. Please try again.",
        },
        { status: 400 }
      );
    }

    // Set profile.email_verified via secure RPC (only service role can call)
    if (data.user && (type === "signup" || type === "email")) {
      const { error: updateError } = await supabaseAdmin.rpc("set_profile_email_verified", {
        target_id: data.user.id,
      });
      if (updateError) {
        console.error("[verify-email] Failed to set profile email_verified:", updateError);
      }
    }

    // Success - email verified
    return NextResponse.json(
      {
        success: true,
        message: "Email verified successfully!",
        user: data.user,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Unexpected error in verify-email route:", error);
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
