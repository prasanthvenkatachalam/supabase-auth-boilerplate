"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/constants";
import { useResendVerification } from "@/hooks/api/use-auth";
import { Link } from "@/i18n/routing";
import { Loader2 } from "lucide-react";

type VerificationState = "loading" | "success" | "expired" | "invalid" | "already_verified" | "error";

export default function VerifyEmailPage() {
  const t = useTranslations("auth");
  const searchParams = useSearchParams();
  const router = useRouter();
  const [state, setState] = useState<VerificationState>("loading");
  const [email, setEmail] = useState<string>("");
  const [resendEmail, setResendEmail] = useState<string>("");
  const [isResending, setIsResending] = useState(false);

  const { mutate: resendVerification } = useResendVerification();

  useEffect(() => {
    const token_hash = searchParams.get("token_hash");
    const type = searchParams.get("type");
    const next = searchParams.get("next") || ROUTES.HOME;

    // If no token or type, show error
    if (!token_hash || !type) {
      setState("invalid");
      toast.error(t("link_invalid") || "Invalid verification link");
      return;
    }

    // Verify the email
    const verifyEmail = async () => {
      try {
        const response = await fetch(
          `/api/auth/verify-email?token_hash=${encodeURIComponent(token_hash)}&type=${encodeURIComponent(type)}`
        );
        const data = await response.json();

        if (response.ok && data.success) {
          setState("success");
          toast.success(t("verification_success") || "Email verified successfully!");
          
          // Extract email from user data if available
          if (data.user?.email) {
            setEmail(data.user.email);
          }

          // Redirect after a short delay
          setTimeout(() => {
            router.push(next);
          }, 2000);
        } else {
          // Handle different error types
          if (data.error === "expired") {
            setState("expired");
            toast.error(t("link_expired") || "This verification link has expired");
          } else if (data.error === "already_verified") {
            setState("already_verified");
            toast.info(t("already_verified") || "Your email is already verified");
            
            // Redirect to login after showing message
            setTimeout(() => {
              router.push(ROUTES.AUTH.LOGIN);
            }, 3000);
          } else if (data.error === "invalid") {
            setState("invalid");
            toast.error(t("link_invalid") || "Invalid verification link");
          } else {
            setState("error");
            toast.error(data.message || t("verification_failed") || "Email verification failed");
          }
        }
      } catch (error) {
        console.error("Verification error:", error);
        setState("error");
        toast.error(t("verification_failed") || "Email verification failed");
      }
    };

    verifyEmail();
  }, [searchParams, router, t]);

  const handleResend = () => {
    if (!resendEmail.trim()) {
      toast.error(t("errors.invalid_email") || "Please enter your email address");
      return;
    }

    setIsResending(true);
    resendVerification(resendEmail, {
      onSuccess: () => {
        setIsResending(false);
        toast.success(t("resend_success") || "Verification email sent! Please check your inbox.");
        setState("success");
      },
      onError: (error: Error) => {
        setIsResending(false);
        if (error.message.includes("rate limit") || error.message.includes("Too many")) {
          toast.error(t("resend_rate_limit") || "Too many resend requests. Please try again later.");
        } else {
          toast.error(error.message || t("resend_failed") || "Failed to resend verification email");
        }
      },
    });
  };

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card className="border-border/50 shadow-xl bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-2xl font-bold">
              {state === "loading" && (t("verifying_email") || "Verifying Email")}
              {state === "success" && (t("verification_success") || "Email Verified")}
              {state === "expired" && (t("link_expired") || "Link Expired")}
              {state === "invalid" && (t("link_invalid") || "Invalid Link")}
              {state === "already_verified" && (t("already_verified") || "Already Verified")}
              {state === "error" && (t("verification_failed") || "Verification Failed")}
            </CardTitle>
            <CardDescription>
              {state === "loading" && (t("verifying_email") || "Please wait, verifying your email...")}
              {state === "success" && "Redirecting you now..."}
              {state === "expired" && "This verification link has expired. Please request a new one."}
              {state === "invalid" && "The verification link is invalid or malformed."}
              {state === "already_verified" && "Your email is already verified. Redirecting to login..."}
              {state === "error" && "An error occurred during verification. Please try again."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {state === "loading" && (
              <div className="flex flex-col items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                <p className="text-sm text-muted-foreground text-center">
                  {t("verifying_email") || "Please wait, verifying your email..."}
                </p>
              </div>
            )}

            {state === "success" && (
              <div className="flex flex-col gap-4 text-center items-center justify-center py-6">
                <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center text-green-500 mb-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                    className="w-6 h-6"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <h3 className="font-semibold text-lg">{t("verification_success") || "Email verified successfully!"}</h3>
                <p className="text-muted-foreground text-sm">
                  {email ? `Verified email: ${email}` : "Redirecting you now..."}
                </p>
                <Button asChild variant="outline" className="mt-4">
                  <Link href={ROUTES.AUTH.LOGIN}>{t("back_to_login") || "Back to Login"}</Link>
                </Button>
              </div>
            )}

            {(state === "expired" || state === "invalid") && (
              <div className="flex flex-col gap-4 py-4">
                <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center text-destructive mb-2 mx-auto">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                    className="w-6 h-6"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                    />
                  </svg>
                </div>
                <div className="space-y-4">
                  <div className="grid gap-2">
                    <Label htmlFor="resend-email">{t("email") || "Email"}</Label>
                    <Input
                      id="resend-email"
                      type="email"
                      placeholder="m@example.com"
                      value={resendEmail}
                      onChange={(e) => setResendEmail(e.target.value)}
                      disabled={isResending}
                    />
                  </div>
                  <Button
                    onClick={handleResend}
                    className="w-full"
                    disabled={isResending || !resendEmail.trim()}
                  >
                    {isResending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t("loading") || "Loading..."}
                      </>
                    ) : (
                      t("resend_verification") || "Resend verification email"
                    )}
                  </Button>
                </div>
                <div className="mt-4 text-center">
                  <Button asChild variant="outline" className="w-full">
                    <Link href={ROUTES.AUTH.LOGIN}>{t("back_to_login") || "Back to Login"}</Link>
                  </Button>
                </div>
              </div>
            )}

            {state === "already_verified" && (
              <div className="flex flex-col gap-4 text-center items-center justify-center py-6">
                <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 mb-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                    className="w-6 h-6"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <h3 className="font-semibold text-lg">{t("already_verified") || "Already Verified"}</h3>
                <p className="text-muted-foreground text-sm">
                  Your email is already verified. You can log in now.
                </p>
                <Button asChild className="mt-4">
                  <Link href={ROUTES.AUTH.LOGIN}>{t("back_to_login") || "Back to Login"}</Link>
                </Button>
              </div>
            )}

            {state === "error" && (
              <div className="flex flex-col gap-4 text-center items-center justify-center py-6">
                <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center text-destructive mb-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                    className="w-6 h-6"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                    />
                  </svg>
                </div>
                <h3 className="font-semibold text-lg">{t("verification_failed") || "Verification Failed"}</h3>
                <p className="text-muted-foreground text-sm">
                  An error occurred during verification. Please try again.
                </p>
                <div className="flex gap-2 mt-4">
                  <Button asChild variant="outline">
                    <Link href={ROUTES.AUTH.LOGIN}>{t("back_to_login") || "Back to Login"}</Link>
                  </Button>
                  <Button asChild>
                    <Link href={ROUTES.AUTH.SIGN_UP}>{t("signup") || "Sign Up"}</Link>
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
