"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Next.js App Router 错误边界。
 * dev 模式展示错误堆栈便于调试，生产模式只保留重试入口。
 * 颜色 / 字号 / 圆角全部走 globals.css 的 DESIGN token（var(--tc-*)），
 * 不在组件内硬编码颜色值。
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 服务端日志用 digest；客户端仅打印 message，避免把堆栈泄露到控制台之外。
    console.error("[route-error]", error.digest ?? error.message);
  }, [error]);

  const isDev = process.env.NODE_ENV !== "production";
  const message = error?.message?.trim();

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center px-4 bg-[var(--tc-bg)] text-[var(--tc-text-primary)]"
      role="alert"
      aria-live="assertive"
    >
      <div className="w-full max-w-md flex flex-col items-center gap-4">
        <span
          aria-hidden
          className="font-outfit text-[64px] font-semibold leading-none text-[var(--tc-text-muted)]"
        >
          ⚠
        </span>
        <h1 className="font-outfit text-[24px] font-semibold leading-[32px] text-center">
          出了点问题
        </h1>
        <p className="text-[14px] leading-[22px] text-center text-[var(--tc-text-secondary)]">
          页面渲染时遇到未预期错误。可以重试，或返回首页继续操作。
        </p>
        {isDev && message ? (
          <pre
            data-testid="error-message"
            className="w-full max-h-40 overflow-auto rounded-lg border px-4 py-3 text-[12px] leading-[18px] font-mono bg-[var(--tc-bg-surface)] border-[var(--tc-border)] text-[var(--tc-text-secondary)]"
          >
            {message}
          </pre>
        ) : null}
        <div className="flex gap-3 mt-2">
          <button
            type="button"
            onClick={reset}
            className="h-10 px-5 rounded-md text-[14px] font-medium cursor-pointer border-none transition-colors duration-120 bg-[var(--tc-accent)] text-[var(--tc-on-accent)] hover:opacity-90"
          >
            重试
          </button>
          <Link
            href="/"
            className="h-10 px-5 rounded-md text-[14px] font-medium inline-flex items-center no-underline transition-colors duration-120 border bg-[var(--tc-bg-surface)] hover:bg-[var(--tc-bg-elevated)] border-[var(--tc-border)] text-[var(--tc-text-primary)]"
          >
            返回首页
          </Link>
        </div>
      </div>
    </main>
  );
}