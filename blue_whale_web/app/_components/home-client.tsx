"use client";

import { useEffect, useState } from "react";
import PromoCapsule from "@/components/PromoCapsule";
import { UserMenu } from "@/components/auth/UserMenu";
import AgentComposer from "@/components/AgentComposer";
import QuickTags from "@/components/QuickTags";
import TemplateCards, { TAG_CONFIG } from "@/components/TemplateCards";

/**
 * HomeClient —— 首页 client 部分（IJZYVT）
 *
 * E2E trigger (Playwright error-boundary spec)：
 * ?e2e_error=1 → hydration commit 后 useEffect 设 shouldThrow=true，
 * 触发 re-render 时 render 阶段抛错，React ErrorBoundary 100% 捕到 → app/error.tsx 渲染。
 *
 * 为何不用 useState initializer 抛错：useState init 只在 mount 时跑一次，
 * hydration 阶段 client 不重跑 init（直接复用 server 提供的 initial state），
 * throw 永远不会触发，error.tsx 永不渲染。
 *
 * 为何不用顶层 `if (...) throw`：同上，hydration match 阶段不会重跑条件 throw。
 * 用 useEffect + setState 触发 re-render 才是可靠路径。
 *
 * 为何不用 webServer.env：env 方案会让其他 spec（loading / not-found）跑时
 * `next dev` 也会 throw，污染全部 spec。query string 局部可控。
 */
export default function HomeClient() {
  const [activeTag, setActiveTag] = useState("short");
  const [shouldThrow, setShouldThrow] = useState(false);

  useEffect(() => {
    if (window.location.search.includes("e2e_error=1")) {
      setShouldThrow(true);
    }
  }, []);

  if (shouldThrow) {
    throw new Error("e2e: route-fallback");
  }

  const { wrapMaxWidth } = TAG_CONFIG[activeTag] ?? TAG_CONFIG.marketing;

  return (
    <main className="relative z-[1] flex flex-col items-center min-h-screen bg-[#0a0a0a]">
      <div className="fixed top-4 right-4 z-[100]">
        <UserMenu />
      </div>
      <div className="flex justify-center pt-[32px]">
        <PromoCapsule />
      </div>

      <h1 className="font-outfit text-[36px] font-semibold leading-[56px] text-center pt-0 mb-[32px] text-white">
        任意视频，告诉你的 Agent 即可创建
      </h1>

      <div className="w-full px-4 mb-10">
        <div className="w-full flex flex-col items-center">
          <AgentComposer />

          <div
            className={`mt-3 flex w-full flex-col gap-3 ${wrapMaxWidth}`}
          >
            <QuickTags active={activeTag} onSelect={setActiveTag} />
            <TemplateCards activeTag={activeTag} />
          </div>
        </div>
      </div>
    </main>
  );
}
