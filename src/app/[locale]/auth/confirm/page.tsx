"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { ROUTES } from "@/constants";
import { routing } from "@/i18n/routing";

/**
 * Auth confirm page – handles both query (token_hash/code) and hash fragment flows.
 * Supabase email links often redirect with tokens in the URL hash (#access_token=...),
 * which the server never sees. This page runs on the client so it can read the hash,
 * restore the session, and redirect to reset-password or error.
 */
export default function AuthConfirmPage() {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || routing.defaultLocale;

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const token_hash = searchParams.get("token_hash");
    const code = searchParams.get("code");
    const type = searchParams.get("type");
    const next = searchParams.get("next") || `/${locale}`;
    const hasHash = typeof window !== "undefined" && window.location.hash?.length > 0;

    const basePath = `/${locale}`;
    const resetPath = `${basePath}${ROUTES.AUTH.RESET_PASSWORD}`;
    const errorPath = `${basePath}${ROUTES.AUTH.ERROR}`;

    // 1. Server can handle these: redirect to API so it can set cookies and redirect
    if (token_hash && type) {
      const apiUrl = `/api/auth/verify-otp?token_hash=${encodeURIComponent(token_hash)}&type=${encodeURIComponent(type)}&next=${encodeURIComponent(next)}`;
      window.location.href = apiUrl;
      return;
    }
    if (code) {
      const apiUrl = `/api/auth/verify-otp?code=${encodeURIComponent(code)}&type=${encodeURIComponent(type || "")}&next=${encodeURIComponent(next)}`;
      window.location.href = apiUrl;
      return;
    }

    // 2. Recovery with hash: Supabase redirected with #access_token=... (server never sees hash).
    // Send tokens to API so the server can set session cookies; then reset-password API will see the user.
    if (type === "recovery" && hasHash) {
      const hashParams = new URLSearchParams(
        window.location.hash.slice(1) // remove leading '#'
      );
      const access_token = hashParams.get("access_token");
      const refresh_token = hashParams.get("refresh_token");

      if (access_token && refresh_token) {
        fetch("/api/auth/set-recovery-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ access_token, refresh_token }),
          credentials: "include",
        })
          .then((res) => {
            if (res.ok) {
              router.replace(resetPath);
            } else {
              router.replace(errorPath);
            }
          })
          .catch(() => router.replace(errorPath));
        return;
      }
      router.replace(errorPath);
      return;
    }

    // 3. No valid params
    router.replace(errorPath);
  }, [locale, router]);

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6">
      <p className="text-muted-foreground">Confirming…</p>
    </div>
  );
}
