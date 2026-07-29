"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Layers, Coins, Users, Receipt, Settings, Shield } from "lucide-react";

const NAV_ITEMS = [
  { href: "/admin", label: "仪表盘", icon: LayoutDashboard },
  { href: "/admin/tiers", label: "充值档位", icon: Layers },
  { href: "/admin/pricing", label: "定价规则", icon: Coins },
  { href: "/admin/users", label: "用户管理", icon: Users },
  { href: "/admin/orders", label: "订单管理", icon: Receipt },
  { href: "/admin/settings", label: "系统设置", icon: Settings },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const isActive = (href: string) => href === "/admin" ? pathname === "/admin" : pathname?.startsWith(href);

  return (
    <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-[var(--tc-border)] bg-[var(--tc-bg-surface)]">
      <div className="flex items-center gap-3 px-5 py-5 border-b border-[var(--tc-border-subtle)]">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--tc-accent,#3b82f6)]">
          <Shield className="h-4 w-4 text-white" />
        </div>
        <div>
          <div className="text-sm font-semibold text-[var(--tc-text-primary)]">管理后台</div>
          <div className="text-[11px] text-[var(--tc-text-muted)]">Blue-Whale Admin</div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link key={href} href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${active ? "bg-[var(--tc-accent,#3b82f6)]/15 text-[var(--tc-accent,#3b82f6)]" : "text-[var(--tc-text-secondary)] hover:bg-[var(--tc-bg-elevated)] hover:text-[var(--tc-text-primary)]"}`}>
              <Icon className="h-4 w-4 shrink-0" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-[var(--tc-border-subtle)] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--tc-bg-elevated)] text-xs font-medium text-[var(--tc-text-secondary)]">A</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-[var(--tc-text-primary)]">管理员</div>
            <div className="text-[11px] text-[var(--tc-text-muted)]">admin@blue-whale</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
