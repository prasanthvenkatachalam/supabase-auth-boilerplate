import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { LogoutButton } from "@/components/auth/logout-button";
import { createClient } from "@/utils/supabase/server";
import { ROUTES } from "@/constants";

export default async function ProtectedPage() {
  const t = await getTranslations("auth");
  const supabase = await createClient();

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    redirect(ROUTES.AUTH.LOGIN);
  }

  return (
    <div className="flex h-svh w-full items-center justify-center gap-2">
      <p>
        {t("hello")} <span>{data.user?.email}</span>
      </p>
      <LogoutButton />
    </div>
  );
}
