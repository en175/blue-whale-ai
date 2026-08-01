/**
 * Next.js App Router 路由级加载骨架。
 * 骨架结构与首页 hero 区域一致：顶部胶囊 → 主标题 → 输入框 → 模板卡组，
 * 用 animate-pulse 做轻量脉动，避免内容切换时跳动。
 * 颜色 / 圆角走 globals.css 的 DESIGN token（var(--tc-*)）。
 */
export default function Loading() {
  return (
    <main
      className="min-h-screen flex flex-col items-center bg-[var(--tc-bg)] text-[var(--tc-text-primary)]"
      role="status"
      aria-live="polite"
      aria-label="页面加载中"
    >
      {/* 顶部胶囊占位（对应 PromoCapsule） */}
      <div className="flex justify-center pt-[32px]">
        <div className="h-[30px] w-[260px] rounded-full bg-[var(--tc-bg-surface)] border border-[var(--tc-border-subtle)] animate-pulse" />
      </div>

      {/* 主标题占位 */}
      <div className="h-[56px] w-[min(640px,90vw)] mt-8 mb-8 rounded-md bg-[var(--tc-bg-surface)] animate-pulse" />

      {/* 输入框占位（对应 AgentComposer） */}
      <div className="w-full px-4 mb-10">
        <div className="w-full flex flex-col items-center gap-3">
          <div className="h-[180px] w-full max-w-[860px] rounded-lg bg-[var(--tc-bg-surface)] border border-[var(--tc-border-subtle)] animate-pulse" />

          {/* 标签条 + 模板卡组占位（对应 QuickTags + TemplateCards） */}
          <div className="h-[28px] w-full max-w-[860px] rounded-md bg-[var(--tc-bg-surface)] animate-pulse" />
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 w-full max-w-[860px]">
            <div className="h-[160px] rounded-lg bg-[var(--tc-bg-surface)] border border-[var(--tc-border-subtle)] animate-pulse" />
            <div className="h-[160px] rounded-lg bg-[var(--tc-bg-surface)] border border-[var(--tc-border-subtle)] animate-pulse" />
            <div className="h-[160px] rounded-lg bg-[var(--tc-bg-surface)] border border-[var(--tc-border-subtle)] animate-pulse" />
          </div>
        </div>
      </div>
    </main>
  );
}
