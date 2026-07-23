"use client";
/**
 * Canvas v2 index —— /canvas-v2（无 projectId）：选/建第一个项目 → replace /canvas-v2/{id}。
 * 具体 project 渲染在 /canvas-v2/[projectId]。
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthContext";
import { loadUser, SKIP_AUTH } from "@/components/auth/authStorage";
import * as canvasApi from "@/lib/canvas";

export default function CanvasV2IndexPage() {
  const router = useRouter();
  const { openLogin } = useAuth();
  const [err, setErr] = useState(false);

  useEffect(() => {
    const u = loadUser();
    if (!SKIP_AUTH && !u) {
      router.replace("/");
      openLogin();
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await canvasApi.listProjects();
        if (cancelled) return;
        const target = list[0] ?? (await canvasApi.createProject("未命名项目"));
        if (cancelled) return;
        router.replace(`/canvas-v2/${target.id}`);
      } catch (e) {
        console.warn("[canvas-v2] load failed", e);
        if (!cancelled) setErr(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, openLogin]);

  if (err) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-black">
        <p className="text-sm" style={{ color: "var(--tc-text-secondary)" }}>画布加载失败（后端未启动？）</p>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="inline-flex h-9 items-center rounded-full px-4 text-sm"
          style={{ background: "var(--tc-bg-surface)", border: "1px solid var(--tc-border-subtle)", color: "var(--tc-text-secondary)" }}
        >
          重试
        </button>
      </div>
    );
  }
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-black text-white/60 text-sm">
      加载画布 v2…
    </div>
  );
}
