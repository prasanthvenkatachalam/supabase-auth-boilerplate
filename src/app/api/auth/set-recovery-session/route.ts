/**
 * POST /api/auth/set-recovery-session
 *
 * Sets the auth session from recovery tokens that landed in the URL hash.
 * The confirm page reads access_token/refresh_token from the hash and POSTs
 * them here so the server can set session cookies. After this, the
 * reset-password API will see the user and allow the password update.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { ERROR_MESSAGES } from "@/constants/messages";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const access_token =
      typeof body.access_token === "string" ? body.access_token : null;
    const refresh_token =
      typeof body.refresh_token === "string" ? body.refresh_token : null;

    if (!access_token || !refresh_token) {
      return NextResponse.json(
        {
          error: "Bad Request",
          message: "access_token and refresh_token are required.",
        },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.setSession({
      access_token,
      refresh_token,
    });

    if (error) {
      console.error("set-recovery-session error:", error);
      return NextResponse.json(
        {
          error: "Invalid or expired link",
          message: error.message,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (e) {
    console.error("Unexpected error in set-recovery-session:", e);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        message: ERROR_MESSAGES.AUTH.INTERNAL_ERROR,
      },
      { status: 500 }
    );
  }
}
