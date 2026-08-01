"use client";

import { useEffect, useState } from "react";
import { fetchTemplatePage } from "@/lib/templates";
import type { TemplateCard } from "@/types/template";
import { TemplateCardItem } from "./TemplateCardItem";

type Container = { type: "grid"; cols: string } | { type: "scroll" };

/**
 * 各标签的容器布局与外层最大宽度（纯前端视图配置，不落库）。
 * cards 数据由后端 /templates/page 接口按 tagCode 分页返回。
 */
const TAG_CONFIG: Record<
  string,
  { container: Container; wrapMaxWidth: string }
> = {
  marketing: {
    container: { type: "grid", cols: "md:grid-cols-4" },
    wrapMaxWidth: "max-w-[1135px]",
  },
  short: {
    container: { type: "grid", cols: "md:grid-cols-3" },
    wrapMaxWidth: "max-w-[848px]",
  },
  replicate: {
    container: { type: "grid", cols: "md:grid-cols-3" },
    wrapMaxWidth: "max-w-[848px]",
  },
  social: { container: { type: "scroll" }, wrapMaxWidth: "" },
  image: {
    container: { type: "grid", cols: "md:grid-cols-3" },
    wrapMaxWidth: "max-w-[848px]",
  },
};

function Skeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="aspect-[4/5] animate-pulse rounded-xl bg-white/[0.04]"
        />
      ))}
    </div>
  );
}

export { TAG_CONFIG };

export default function TemplateCards({
  activeTag,
  onAppendPrompt,
}: {
  activeTag: string;
  onAppendPrompt?: (text: string) => void;
}) {
  const [cards, setCards] = useState<TemplateCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTemplatePage(activeTag, 1, 50)
      .then((page) => {
        if (cancelled) return;
        setCards(page.records);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "加载失败");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTag]);

  const container =
    TAG_CONFIG[activeTag]?.container ?? TAG_CONFIG.marketing.container;

  if (loading) {
    return <Skeleton />;
  }

  if (error || cards.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-10 text-center text-sm text-white/60">
        {error ?? "暂无模板"}
      </div>
    );
  }

  if (container.type === "scroll") {
    return (
      <div className="ncs-thin-scrollbar -mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 pb-1">
        <div className="flex w-max min-w-full justify-center gap-3">
          {cards.map((card, idx) => (
            <TemplateCardItem
              key={`${activeTag}-${idx}`}
              card={card}
              index={idx}
              onAppendPrompt={onAppendPrompt}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-2 gap-3 ${container.cols}`}>
      {cards.map((card, idx) => (
        <TemplateCardItem
          key={`${activeTag}-${idx}`}
          card={card}
          index={idx}
          onAppendPrompt={onAppendPrompt}
        />
      ))}
    </div>
  );
}
