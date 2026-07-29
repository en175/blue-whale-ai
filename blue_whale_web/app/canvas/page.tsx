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
  const { openLogin } = useAuth();
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (projectId) return;
    const user = loadUser();
    if (!SKIP_AUTH && !user) {
      router.replace("/");
      openLogin();
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const projects = await canvasApi.listProjects();
        const target = projects[0] ?? (await canvasApi.createProject("未命名项目"));
        if (!cancelled) router.replace(canonicalCanvasHref(String(target.id)));
      } catch (error) {
        console.warn("[canvas] resolve project failed", error);
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openLogin, projectId, router]);

  if (projectId) return <CanvasProjectRuntime projectId={projectId} />;

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-black text-sm text-white/60">
      {loadError ? "画布加载失败，请刷新重试" : "加载画布…"}
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
