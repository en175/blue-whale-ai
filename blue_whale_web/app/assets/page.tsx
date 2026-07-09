"use client";

/**
 * 资产库页 /assets：网格展示资产 + type（全部/图片/视频）筛选，调 listAssets。
 * 颜色走 globals.css 的 --tc-* / --background CSS 变量，不硬编码 hex。
 */

import { useCallback, useEffect, useState } from "react";
import { listAssets, type AssetItem } from "@/lib/assets";

type Filter = "all" | "image" | "video";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "image", label: "图片" },
  { id: "video", label: "视频" },
];

function AssetTile({ asset }: { asset: AssetItem }) {
  if (asset.type === "video") {
    return (
      <video
        src={asset.url}
        className="aspect-square w-full rounded-lg border border-[var(--tc-border)] object-cover"
        muted
        loop
        playsInline
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={asset.url}
      alt=""
      className="aspect-square w-full rounded-lg border border-[var(--tc-border)] object-cover"
    />
  );
}

export default function AssetsPage() {
  const [items, setItems] = useState<AssetItem[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await listAssets({ type: filter === "all" ? undefined : filter, size: 60 });
      setItems(page.records);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    // 数据获取是 React 官方认可模式；set-state-in-effect 规则对列表 fetch 误报。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <main className="flex min-h-screen flex-col bg-[var(--background)]">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-4 py-8">
        <div className="flex items-center justify-between">
          <h1 className="font-outfit text-2xl font-semibold text-[var(--tc-text-primary)]">
            资产库
          </h1>
          <div className="flex gap-2">
            {FILTERS.map((f) => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={
                    "rounded-lg border px-3 py-1 text-sm transition-colors " +
                    (active
                      ? "border-[var(--tc-accent)] bg-[var(--tc-accent)] text-white"
                      : "border-[var(--tc-border)] bg-transparent text-[var(--tc-text-secondary)] hover:text-[var(--tc-text-primary)]")
                  }
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>
        {error && <p className="text-sm text-[var(--tc-destructive)]">{error}</p>}
        {loading ? (
          <p className="text-sm text-[var(--tc-text-muted)]">加载中…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-[var(--tc-text-muted)]">暂无资产。</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {items.map((asset) => (
              <AssetTile key={asset.id} asset={asset} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
