"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "@/components/auth/AuthContext";
import { loadUser, SKIP_AUTH } from "@/components/auth/authStorage";
import * as canvasApi from "@/lib/canvas";

import { canonicalCanvasHref } from "./canonical-project";
import { CanvasProjectRuntime } from "./CanvasProjectRuntime";

function CanvasPageInner() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");
  const incomingTab = searchParams.get("tab");
  const router = useRouter();
  const { user, openLogin } = useAuth();
  const [loadError, setLoadError] = useState(false);
  // 凭证刚失效（401 已清登录态并弹登录框）：停留原地，登录完成后自动重试，不落死胡同。
  const [awaitingRelogin, setAwaitingRelogin] = useState(false);

  useEffect(() => {
    if (projectId) return;
    const stored = loadUser();
    if (!SKIP_AUTH && !stored) {
      if (!awaitingRelogin) {
        router.replace("/");
        openLogin();
      }
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        // IK74TX 1.1/1.2/1.3：从首页输入框带内容跳转（?tab=…）→ 一律新建项目，
        // 不进老项目（外部首页创作是独立会话）；项目名取提示词前 15 字，无提示词回退未命名。
        if (incomingTab) {
          const prompt = searchParams.get("prompt") ?? "";
          const name = prompt.trim() ? prompt.trim().slice(0, 15) : "未命名项目";
          const created = await canvasApi.createProject(name);
          // 保留首页携带的全部 query 参数（tab/prompt/model/…），拼上新 project id，
          // 供 CanvasProjectRuntime 落地后读参数预填 Dock + 自动生成 / Agent 接管。
          const next = new URLSearchParams(searchParams.toString());
          next.set("project", String(created.id));
          if (!cancelled) router.replace(`/canvas?${next.toString()}`);
          return;
        }
        const projects = await canvasApi.listProjects();
        const target =
          projects[0] ?? (await canvasApi.createProject("未命名项目"));
        if (!cancelled) router.replace(canonicalCanvasHref(String(target.id)));
      } catch (error) {
        if (error instanceof canvasApi.ApiError && error.code === 401) {
          if (!cancelled) setAwaitingRelogin(true);
          return;
        }
        console.warn("[canvas] resolve project failed", error);
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [awaitingRelogin, user, openLogin, projectId, incomingTab, searchParams, router]);

  if (projectId) return <CanvasProjectRuntime projectId={projectId} />;

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-black text-sm text-white/60">
      {loadError ? (
        "画布加载失败，请刷新重试"
      ) : awaitingRelogin && !user ? (
        <>
          <span>登录已失效，请重新登录后继续</span>
          <button
            type="button"
            onClick={openLogin}
            className="rounded-lg border border-white/10 px-4 py-1.5 text-white/70 hover:border-white/20"
          >
            重新登录
          </button>
        </>
      ) : (
        "加载画布…"
      )}
    </div>
  );
}

export default function CanvasPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-screen items-center justify-center bg-black text-sm text-white/60">
          加载画布…
        </div>
      }
    >
      <CanvasPageInner />
    </Suspense>
  );
}
