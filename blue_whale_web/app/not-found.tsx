import Link from "next/link";

/**
 * Next.js App Router 路由级 404 兜底。
 * 任意未匹配路由（如 /canvas/<不存在-id>）会渲染此页。
 * 颜色 / 字号 / 圆角走 globals.css 的 DESIGN token（var(--tc-*)）。
 */
export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 bg-[var(--tc-bg)] text-[var(--tc-text-primary)]">
      <div className="w-full max-w-md flex flex-col items-center gap-4">
        <span
          aria-hidden
          className="font-outfit text-[88px] font-semibold leading-none text-[var(--tc-text-muted)]"
        >
          404
        </span>
        <h1 className="font-outfit text-[24px] font-semibold leading-[32px] text-center">
          页面不存在
        </h1>
        <p className="text-[14px] leading-[22px] text-center text-[var(--tc-text-secondary)]">
          你访问的链接可能已被移动或删除。回到首页继续创作。
        </p>
        <Link
          href="/"
          className="mt-2 h-10 px-5 rounded-md text-[14px] font-medium inline-flex items-center no-underline transition-colors duration-120 bg-[var(--tc-accent)] text-[var(--tc-on-accent)] hover:opacity-90"
        >
          返回首页
        </Link>
      </div>
    </main>
  );
}