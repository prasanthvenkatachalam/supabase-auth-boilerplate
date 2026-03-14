"use client";

import { UpdatePasswordForm } from "@/components/auth/update-password-form";
import { useSearchParams } from "next/navigation";

export default function Page() {
  const searchParams = useSearchParams();
  const code = searchParams.get("code");

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <UpdatePasswordForm code={code} />
      </div>
    </div>
  );
}
