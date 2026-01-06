"use client";

import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, usePathname } from "@/i18n/routing";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useResetPassword } from "@/hooks/api/use-auth";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/validations/auth";
import { ROUTES } from "@/constants";

export function ForgotPasswordForm({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  const t = useTranslations("auth");
  const pathname = usePathname();
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const { mutate: resetPassword, isPending } = useResetPassword();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
    },
  });

  const onSubmit = (data: ForgotPasswordInput) => {
    setServerError(null);
    // Construct redirect URL with locale
    const locale = pathname.split("/")[1] || "en";
    const redirectTo = `${window.location.origin}/${locale}/auth/update-password`;

    resetPassword(
      { email: data.email, redirectTo },
      {
        onSuccess: () => {
          setSuccess(true);
        },
        onError: (error) => {
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
              <Link href={ROUTES.AUTH.LOGIN}>{t("back_to_login")}</Link>
            </Button>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <div className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="email">{t("email")}</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="m@example.com"
                    {...register("email")}
                    className={cn(errors.email && "border-destructive")}
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

              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? t("loading") : t("submit_reset")}
              </Button>

              <div className="mt-4 text-center text-sm">
                <Link
                  href={ROUTES.AUTH.LOGIN}
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
