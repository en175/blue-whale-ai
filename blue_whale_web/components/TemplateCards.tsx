"use client";

import { useEffect, useState } from "react";
import { fetchTemplatePage } from "@/lib/templates";
import type { TemplateCard } from "@/types/template";
import { TemplateCardItem } from "./TemplateCardItem";

type Container = { type: "grid"; cols: string } | { type: "scroll" };

/** 布局映射：纯前端视图细节，不进 DB */
const TAG_LAYOUT: Record<string, Container> = {
  marketing: { type: "grid", cols: "md:grid-cols-4" },
  short: { type: "grid", cols: "md:grid-cols-3" },
  replicate: { type: "grid", cols: "md:grid-cols-3" },
  social: { type: "scroll" },
  image: { type: "grid", cols: "md:grid-cols-3" },
};

function Skeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="aspect-[4/5] animate-pulse rounded-xl bg-white/[0.04]" />
      ))}
    </div>
  );
}

export default function TemplateCards({ activeTag }: { activeTag: string }) {
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

  const container = TAG_LAYOUT[activeTag] ?? TAG_LAYOUT.marketing;

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
            <TemplateCardItem key={`${activeTag}-${idx}`} card={card} index={idx} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-2 gap-3 ${container.cols}`}>
      {cards.map((card, idx) => (
        <TemplateCardItem key={`${activeTag}-${idx}`} card={card} index={idx} />
      ))}
    </div>
  );
}
