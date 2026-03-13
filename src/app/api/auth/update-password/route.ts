import { NextRequest, NextResponse } from "next/server";
import { updatePasswordSchema } from "@/lib/validations/auth";
import { checkUpdatePasswordRateLimit } from "@/lib/rate-limit";
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from "@/constants/messages";
import { createClient } from "@/utils/supabase/server";

export const runtime = 'nodejs';

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
 * POST /api/auth/update-password
 * 
 * Handles password update with rate limiting
 */
export async function POST(request: NextRequest) {
  try {
    const bodyPromise = request.json();
    const clientIp = getClientIp(request);
    
    const body = await bodyPromise;
    const validationResult = updatePasswordSchema.safeParse(body);
    
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: ERROR_MESSAGES.VALIDATION.INVALID_INPUT,
          details: validationResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { password } = validationResult.data;

    // Rate Limit Check
    // We need an identifier. Since the user is logged in (presumably, as they are updating password),
    // we could use their ID. However, this endpoint might be hit after a password reset link,
    // where they are authenticated via the link. 
    // Ideally we should use the user's email or ID.
    
    // Authenticate user first to get their email/ID for rate limiting
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
       return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to update your password." },
        { status: 401 }
      );
    }

    if (!user.email) {
       return NextResponse.json(
        { 
          error: "Bad Request", 
          message: "User email is missing. Please contact support if this persists.",
          code: "missing_email"
        },
        { status: 400 }
      );
    }

    const email = user.email;

    console.time("rate-limit-check");
    // Use email for rate limiting as well as IP
    const rateLimitResult = await checkUpdatePasswordRateLimit(clientIp, email);
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
        }
      );
    }

    // Update Password
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    if (updateError) {
      console.error("Update password error:", updateError);
      
      let status = 500;
      let errorCode = "update_failed";

      // Map Supabase error messages/codes to HTTP status codes
      if (updateError.message.includes("weak") || updateError.status === 400) {
        status = 400;
        errorCode = "weak_password";
      } else if (updateError.message.includes("previous") || updateError.message.includes("same") || updateError.status === 409) {
        status = 409;
        errorCode = "password_already_used";
      } else if (updateError.status === 422) {
        status = 422;
        errorCode = "validation_error";
      }

      return NextResponse.json(
        { 
          error: "Update Failed", 
          message: updateError.message,
          code: errorCode 
        },
        { status }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "Password updated successfully",
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("Unexpected error in update-password route:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        message: ERROR_MESSAGES.AUTH.INTERNAL_ERROR,
      },
      { status: 500 }
    );
  }
}
