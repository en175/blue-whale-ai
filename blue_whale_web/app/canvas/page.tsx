"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "@/components/auth/AuthContext";
import { loadUser, SKIP_AUTH } from "@/components/auth/authStorage";
import * as canvasApi from "@/lib/canvas";

import { canonicalCanvasHref } from "./canonical-project";
import { CanvasProjectRuntime } from "./CanvasProjectRuntime";

function CanvasPageInner() {
  const projectId = useSearchParams().get("project");
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
  }, [awaitingRelogin, user, openLogin, projectId, router]);

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
