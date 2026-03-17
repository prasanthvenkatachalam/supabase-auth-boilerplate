import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTranslations } from "next-intl/server";
import { ROUTES } from "@/constants";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  const t = await getTranslations("auth");
  const errorCode = query?.error;
  const forgotPasswordHref = `/${locale}${ROUTES.AUTH.FORGOT_PASSWORD}`;
  const isResetLinkError = errorCode === "invalid_reset_token";
  const title = isResetLinkError ? t("errors.invalid_reset_token") : t("errors.default");
  const message = isResetLinkError ? t("errors.invalid_reset_token") : t("errors.default");

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">{title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">{message}</p>
              {isResetLinkError && (
                <>
                  <p className="text-xs text-muted-foreground">
                    {t("errors.invalid_reset_token_hint")}
                  </p>
                  <Link
                    href={forgotPasswordHref}
                    className="text-sm font-medium text-primary underline underline-offset-4"
                  >
                    {t("forgot_password_request_new_link")}
                  </Link>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
