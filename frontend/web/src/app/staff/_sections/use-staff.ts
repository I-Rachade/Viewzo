"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "../../_shell/session";

// Sends people who aren't on the team away from back-office pages.
export function useStaffOnly() {
  const router = useRouter();
  const { user } = useSession();
  useEffect(() => {
    if (user === null) router.replace("/login");
    else if (user && !user.isStaff) router.replace("/dashboard");
  }, [user, router]);
  return !!user?.isStaff;
}
