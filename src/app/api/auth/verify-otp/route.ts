/**
 * Server-side OTP/code verification for auth callback.
 * Used when the confirm page has token_hash or code in the query string.
 * Verifies with Supabase, sets session cookies, and redirects to the next URL.
 */

import { type NextRequest, NextResponse } from "next/server";
import { ROUTES } from "@/constants";
import { createClient } from "@/utils/supabase/server";
import { supabaseAdmin } from "@/utils/supabase/admin";
import { type EmailOtpType } from "@supabase/supabase-js";
import { routing } from "@/i18n/routing";

const ALLOWED_EMAIL_OTP_TYPES: readonly EmailOtpType[] = [
  "signup",
  "recovery",
  "magiclink",
  "invite",
  "email_change",
  "email",
] as const;

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (ALLOWED_EMAIL_OTP_TYPES as readonly string[]).includes(value);
}

function getLocaleFromNext(next: string): string {
  const segments = next.split("/").filter(Boolean);
  if (segments.length > 0 && routing.locales.includes(segments[0] as "en")) {
    return segments[0];
  }
  return routing.defaultLocale;
}

/** OTP types that indicate email was just verified (set profile.email_verified) */
const EMAIL_VERIFICATION_TYPES: readonly EmailOtpType[] = ["signup", "email"];

/** Set profile.email_verified via secure RPC (only service role can call). */
async function setProfileEmailVerified(userId: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc("set_profile_email_verified", {
    target_id: userId,
  });
  if (error) {
    console.error("[verify-otp] Failed to set profile email_verified:", error);
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const code = searchParams.get("code");
  const typeRaw = searchParams.get("type");
  if (typeRaw !== null && !isEmailOtpType(typeRaw)) {
    return NextResponse.json(
      { error: "Bad Request", message: "Invalid or unsupported type parameter." },
      { status: 400 },
    );
  }
  const type: EmailOtpType | null = typeRaw;
  const _next = searchParams.get("next");
  const next = _next?.startsWith("/") ? _next : `/${routing.defaultLocale}${ROUTES.HOME}`;
  const origin = request.nextUrl.origin;
  const locale = getLocaleFromNext(next);

  const supabase = await createClient();

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data?.user) {
      if (type === "recovery") {
        return NextResponse.redirect(`${origin}/${locale}${ROUTES.AUTH.RESET_PASSWORD}`);
      }
      if (type && EMAIL_VERIFICATION_TYPES.includes(type)) {
        await setProfileEmailVerified(data.user.id);
      }
      const target = `${origin}${next}`;
      return NextResponse.redirect(target);
    }
  }

  if (token_hash && type) {
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error && data?.user) {
      if (type === "recovery") {
        return NextResponse.redirect(`${origin}/${locale}${ROUTES.AUTH.RESET_PASSWORD}`);
      }
      if (EMAIL_VERIFICATION_TYPES.includes(type)) {
        await setProfileEmailVerified(data.user.id);
      }
      const params = new URLSearchParams();
      params.set("token_hash", token_hash);
      params.set("type", type);
      params.set("next", next);
      return NextResponse.redirect(
        `${origin}/${locale}${ROUTES.AUTH.VERIFY_EMAIL}?${params.toString()}`,
      );
    }
  }

  const errorRedirect =
    type === "recovery"
      ? `${origin}/${locale}${ROUTES.AUTH.ERROR}?error=invalid_reset_token`
      : `${origin}/${locale}${ROUTES.AUTH.ERROR}`;
  return NextResponse.redirect(errorRedirect);
}
