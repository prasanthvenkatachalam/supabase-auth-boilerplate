import { NextRequest, NextResponse } from "next/server";
import { updatePasswordSchema } from "@/lib/validations/auth";
import { checkResetPasswordRateLimit } from "@/lib/rate-limit";
import { ERROR_MESSAGES } from "@/constants/messages";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

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
 * POST /api/auth/reset-password
 *
 * Handles password reset for already authenticated users (via reset link session)
 */
export async function POST(request: NextRequest) {
  try {
    const clientIp = getClientIp(request);
    const body = await request.json();
    
    const validationResult = updatePasswordSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: ERROR_MESSAGES.VALIDATION.INVALID_INPUT,
          details: validationResult.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const { password } = validationResult.data;

    const supabase = await createClient();
    
    // In this flow, the user MUST already be authenticated via the session 
    // established by the code exchange in the /auth/confirm route.
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        {
          error: "Unauthorized",
          message: "User not logged in. Please use the reset link from your email.",
        },
        { status: 401 },
      );
    }

    const email = user.email || "unknown";

    // Rate Limit Check
    const rateLimitResult = await checkResetPasswordRateLimit(clientIp, email);

    if (!rateLimitResult.allowed) {
      const resetDate = rateLimitResult.resetAt;
      const retryAfterSeconds = resetDate
        ? Math.ceil((resetDate.getTime() - Date.now()) / 1000)
        : 900;

      return NextResponse.json(
        {
          error: ERROR_MESSAGES.RATE_LIMIT.GENERIC,
          message: ERROR_MESSAGES.RATE_LIMIT.EMAIL,
          retryAfter: retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            "Retry-After": retryAfterSeconds.toString(),
          },
        },
      );
    }

    // Update Password
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    if (updateError) {
      console.error("Reset password error:", updateError);

      let status = 500;
      let errorCode = "reset_failed";

      if (updateError.message.includes("weak") || updateError.status === 400) {
        status = 400;
        errorCode = "weak_password";
      } else if (updateError.status === 409) {
        status = 409;
        errorCode = "password_already_used";
      }

      return NextResponse.json(
        {
          error: "Reset Failed",
          message: updateError.message,
          code: errorCode,
        },
        { status },
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "Password reset successfully",
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Unexpected error in reset-password route:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        message: ERROR_MESSAGES.AUTH.INTERNAL_ERROR,
      },
      { status: 500 },
    );
  }
}
