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
import { type EmailOtpType } from "@supabase/supabase-js";

export const runtime = 'nodejs';

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
    const { searchParams } = new URL(request.url);
    const token_hash = searchParams.get("token_hash");
    const type = searchParams.get("type") as EmailOtpType | null;

    // Validate required parameters
    if (!token_hash || !type) {
      return NextResponse.json(
        {
          success: false,
          error: "invalid",
          message: "Missing verification token or type",
        },
        { status: 400 }
      );
    }

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
