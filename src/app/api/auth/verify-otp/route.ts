/**
 * Server-side OTP/code verification for auth callback.
 * Used when the confirm page has token_hash or code in the query string.
 * Verifies with Supabase, sets session cookies, and redirects to the next URL.
 */

import { type NextRequest, NextResponse } from "next/server";
import { ROUTES } from "@/constants";
import { createClient } from "@/utils/supabase/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { routing } from "@/i18n/routing";

function getLocaleFromNext(next: string): string {
  const segments = next.split("/").filter(Boolean);
  if (segments.length > 0 && routing.locales.includes(segments[0] as "en")) {
    return segments[0];
  }
  return routing.defaultLocale;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const code = searchParams.get("code");
  const type = searchParams.get("type") as EmailOtpType | null;
  const _next = searchParams.get("next");
  const next = _next?.startsWith("/") ? _next : `/${routing.defaultLocale}${ROUTES.HOME}`;
  const origin = request.nextUrl.origin;
  const locale = getLocaleFromNext(next);

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (type === "recovery") {
        return NextResponse.redirect(`${origin}/${locale}${ROUTES.AUTH.RESET_PASSWORD}`);
      }
      const target = next.startsWith("http") ? next : `${origin}${next}`;
      return NextResponse.redirect(target);
    }
  }

  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      if (type === "recovery") {
        return NextResponse.redirect(`${origin}/${locale}${ROUTES.AUTH.RESET_PASSWORD}`);
      }
      const params = new URLSearchParams();
      params.set("token_hash", token_hash);
      params.set("type", type);
      params.set("next", next);
      return NextResponse.redirect(
        `${origin}/${locale}${ROUTES.AUTH.VERIFY_EMAIL}?${params.toString()}`
      );
    }
  }

  return NextResponse.redirect(`${origin}/${locale}${ROUTES.AUTH.ERROR}`);
}
