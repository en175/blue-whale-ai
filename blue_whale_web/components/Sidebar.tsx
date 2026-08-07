"use client";

/**
 * Sidebar —— 全局左侧窄导航栏（首页 / 项目 / 生成 / 资产 / 画布）。
 *
 * 对标即梦窄图标栏（~76px）：图标在上、小字在下，垂直排列。logo 用图标（点回首页）。
 * canvas 路由（/canvas 开头）自隐藏：使 canvas 保持全屏、内容不动（守「不动 canvas」约束）。
 * 颜色全走 globals.css 的 --tc-* 变量（DESIGN token），不硬编码 hex。
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FolderKanban,
  FolderOpen,
  Home,
  LayoutGrid,
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "首页", icon: Home },
  { href: "/projects", label: "项目", icon: FolderKanban },
  // IK6XQI-4：生成页已下线（发送后直达画布），导航入口一并移除。
  { href: "/assets", label: "资产", icon: FolderOpen },
  { href: "/canvas", label: "画布", icon: LayoutGrid },
];

export default function Sidebar() {
  const pathname = usePathname();
  // canvas 全屏工作台：左栏自隐藏，避免挤压/遮挡其内容。
  if (pathname?.startsWith("/canvas") || pathname?.startsWith("/admin"))
    return null;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname?.startsWith(href);

  return (
    <aside className="sticky top-0 flex h-screen w-[var(--tc-sidebar-width)] shrink-0 flex-col items-center gap-1 border-r border-[var(--tc-border)] bg-[var(--tc-bg-surface)] py-4">
      <Link
        href="/"
        aria-label="Blue-Whale 首页"
        className="mb-3 flex h-[42px] w-[42px] items-center justify-center rounded-lg text-[var(--tc-accent)] transition-colors hover:bg-[var(--tc-bg-elevated)]"
      >
        <img
          src="/blue_whale.svg"
          alt="Blue-Whale"
          className="h-[27px] w-auto"
        />
      </Link>
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={
              "flex w-14 flex-col items-center gap-1 rounded-lg py-2 text-center transition-colors " +
              (active
                ? "bg-[var(--tc-accent)] text-white"
                : "text-[var(--tc-text-secondary)] hover:bg-[var(--tc-bg-elevated)] hover:text-[var(--tc-text-primary)]")
            }
          >
            <Icon className="h-5 w-5" />
            <span className="text-[11px] font-medium leading-none">
              {label}
            </span>
          </Link>
        );
      })}
    </aside>
  );
}
