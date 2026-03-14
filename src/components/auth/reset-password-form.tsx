"use client";

import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "@/i18n/routing";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useUpdatePassword } from "@/hooks/api/use-auth";
import { updatePasswordSchema, type UpdatePasswordInput } from "@/lib/validations/auth";
import { ROUTES } from "@/constants";
import { Captcha } from "@/components/auth/turnstile";
import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { useRef } from "react";

export function ResetPasswordForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isCaptchaLoading, setIsCaptchaLoading] = useState(true);
  const captchaRef = useRef<TurnstileInstance>(null);

  const { mutate: updatePassword, isPending } = useUpdatePassword();

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<UpdatePasswordInput>({
    resolver: zodResolver(updatePasswordSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
      captchaToken: "",
    },
  });

  const onSubmit = (data: UpdatePasswordInput) => {
    setServerError(null);
    setShowPassword(false);
    setShowConfirmPassword(false);

    updatePassword(
      data,
      {
        onSuccess: () => {
          router.replace(ROUTES.PROTECTED);
        },
        onError: (error) => {
          setServerError(error.message || t("errors.default"));
          // Reset Captcha on failure
          captchaRef.current?.reset();
          setValue("captchaToken", "");
          setIsCaptchaLoading(true);
        },
      },
    );
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="border-border/50 shadow-xl bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">{t("update_password")}</CardTitle>
          <CardDescription>{t("update_password_desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <input type="hidden" {...register("captchaToken")} />
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="password">{t("password")}</Label>
                <PasswordInput
                  id="password"
                  {...register("password")}
                  className={cn(errors.password && "border-destructive")}
                  isVisible={showPassword}
                  onVisibilityChange={setShowPassword}
                  disabled={isPending}
                />
                {errors.password && (
                  <p className="text-sm text-destructive">{errors.password.message}</p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="confirmPassword">{t("confirm_password")}</Label>
                <PasswordInput
                  id="confirmPassword"
                  {...register("confirmPassword")}
                  className={cn(errors.confirmPassword && "border-destructive")}
                  isVisible={showConfirmPassword}
                  onVisibilityChange={setShowConfirmPassword}
                  disabled={isPending}
                />
                {errors.confirmPassword && (
                  <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
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
                if (
                  serverError === t("errors.captcha_expired") ||
                  serverError === t("errors.captcha_failed")
                ) {
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
                setIsCaptchaLoading(true);
              }}
            />
            {errors.captchaToken && (
              <p className="text-sm text-destructive mt-[-1rem] mb-4 text-center">
                {errors.captchaToken.message}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={isPending || isCaptchaLoading}>
              {isPending ? t("loading") : t("submit_update")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
