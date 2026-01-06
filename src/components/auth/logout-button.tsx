"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { useSignOut } from "@/hooks/api/use-auth";
import { ROUTES } from "@/constants";

export function LogoutButton() {
  const router = useRouter();
  const t = useTranslations("auth");

  const { mutate: signOut, isPending } = useSignOut();

  const handleLogout = () => {
    signOut(undefined, {
      onSuccess: () => {
        router.push(ROUTES.AUTH.LOGIN);
      },
    });
  };

  return (
    <Button
      variant="ghost"
      onClick={handleLogout}
      disabled={isPending}
      className="text-destructive hover:text-destructive hover:bg-destructive/10"
    >
      {isPending ? t("loading") : t("logout")}
    </Button>
  );
}
