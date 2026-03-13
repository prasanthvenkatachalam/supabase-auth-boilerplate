"use client";

import { useTranslations, useLocale } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "@/i18n/routing";
import { useState, useRef } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useResetPassword } from "@/hooks/api/use-auth";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/validations/auth";
import { ROUTES } from "@/constants";
import { Captcha } from "@/components/auth/turnstile";
import type { TurnstileInstance } from "@marsidev/react-turnstile";

export function ForgotPasswordForm({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isCaptchaLoading, setIsCaptchaLoading] = useState(true);
  const captchaRef = useRef<TurnstileInstance>(null);

  const { mutate: resetPassword, isPending } = useResetPassword();

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
      captchaToken: "",
    },
  });

  const onSubmit = (data: ForgotPasswordInput) => {
    setServerError(null);
    // Construct redirect URL with locale
    const redirectTo = `${window.location.origin}/${locale}/auth/update-password`;

    resetPassword(
      { email: data.email, captchaToken: data.captchaToken, redirectTo },
      {
        onSuccess: () => {
          setSuccess(true);
        },
        onError: (error) => {
          captchaRef.current?.reset();
          setValue("captchaToken", "");
          setIsCaptchaLoading(true);
          setServerError(error.message || t("errors.default"));
        },
      }
    );
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="border-border/50 shadow-xl bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">
            {success ? t("check_email") : t("forgot_password_Title")}
          </CardTitle>
          <CardDescription>{success ? t("reset_sent") : t("forgot_password_desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {success ? (
            <Button asChild className="w-full mt-4">
              <Link href={ROUTES.AUTH.LOGIN} prefetch={false}>{t("back_to_login")}</Link>
            </Button>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <input type="hidden" {...register("captchaToken")} />
              <div className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="email">{t("email")}</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="m@example.com"
                    {...register("email")}
                    className={cn(errors.email && "border-destructive")}
                    disabled={isPending}
                  />
                  {errors.email && (
                    <p className="text-sm text-destructive">{errors.email.message}</p>
                  )}
                </div>
              </div>

              {serverError && (
                <div className="text-sm text-destructive font-medium bg-destructive/10 p-3 rounded-md">
                  {serverError}
                </div>
              )}

              <Captcha
                ref={captchaRef}
                onSuccess={(token) => {
                  setValue("captchaToken", token, { shouldValidate: true });
                  setIsCaptchaLoading(false);
                  if (serverError === t("errors.captcha_expired") || serverError === t("errors.captcha_failed")) {
                    setServerError(null);
                  }
                }}
                onExpire={() => {
                  setValue("captchaToken", "");
                  setServerError(t("errors.captcha_expired"));
                  setIsCaptchaLoading(true);
                }}
                onError={() => {
                  setServerError(t("errors.captcha_failed"));
                  setValue("captchaToken", "");
                  setIsCaptchaLoading(false);
                }}
              />
              {errors.captchaToken && (
                <p className="text-sm text-destructive mt-[-1rem] mb-4 text-center">
                  {errors.captchaToken.message}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={isPending || isCaptchaLoading}>
                {isPending ? t("loading") : t("submit_reset")}
              </Button>

              <div className="mt-4 text-center text-sm">
                <Link
                  href={ROUTES.AUTH.LOGIN}
                  prefetch={false}
                  className="text-primary hover:underline underline-offset-4"
                >
                  {t("back_to_login")}
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
