import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { ROUTES } from "@/constants";

/**
 * Email confirmation route handler
 * 
 * This route receives the email verification link and redirects to the
 * verify-email page which handles the verification with proper UX (loading states, toasts, etc.)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const _next = searchParams.get("next");
  const next = _next?.startsWith("/") ? _next : ROUTES.HOME;

  // Build query parameters for the verify-email page
  const params = new URLSearchParams();
  if (token_hash) params.set("token_hash", token_hash);
  if (type) params.set("type", type);
  if (next !== ROUTES.HOME) params.set("next", next);

  // Redirect to verify-email page with all parameters
  redirect(`${ROUTES.AUTH.VERIFY_EMAIL}?${params.toString()}`);
}
