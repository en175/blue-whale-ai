"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AdminSidebar } from "./_components/admin-sidebar";
import { isAdminAuthenticated } from "./_lib/auth";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (pathname === "/admin/login") { setReady(true); return; }
    if (!isAdminAuthenticated()) { router.replace("/admin/login"); return; }
    setReady(true);
  }, [pathname, router]);

  if (pathname === "/admin/login") return <>{children}</>;

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a0a0a]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--tc-accent,#3b82f6)] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#0a0a0a]">
      <AdminSidebar />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
