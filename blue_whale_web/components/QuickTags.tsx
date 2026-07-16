"use client";

import { useEffect, useState } from "react";
import { Clapperboard, Copy, Image as ImageIcon, Megaphone, Share2, type LucideIcon } from "lucide-react";
import { fetchTemplateTags } from "@/lib/templates";
import type { TemplateTag } from "@/types/template";

/** 标签图标映射（图标是视图资产，前端维护，不入库） */
const ICON_MAP: Record<string, LucideIcon> = {
  marketing: Megaphone,
  short: Clapperboard,
  replicate: Copy,
  social: Share2,
  image: ImageIcon,
};
const DEFAULT_ICON = Megaphone;

export default function QuickTags({
  active,
  onSelect,
}: {
  active: string;
  onSelect: (code: string) => void;
}) {
  const [tags, setTags] = useState<TemplateTag[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchTemplateTags()
      .then((list) => {
        if (!cancelled) setTags(list);
      })
      .catch(() => {
        // 加载失败留空，下方渲染占位
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (tags.length === 0) {
    return <div className="h-8 w-full" aria-hidden />;
  }

  return (
    <div className="ncs-thin-scrollbar flex w-full items-center justify-center gap-1.5 overflow-x-auto">
      {tags.map((tag) => {
        const Icon = ICON_MAP[tag.tagCode] ?? DEFAULT_ICON;
        const isActive = active === tag.tagCode;
        return (
          <button
            key={tag.tagCode}
            type="button"
            onClick={() => onSelect(tag.tagCode)}
            className={`group inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-all duration-200 ${
              isActive
                ? "bg-white/[0.09] text-white/90"
                : "text-white/45 hover:bg-white/[0.05] hover:text-white/75"
            }`}
          >
            <Icon
              width={14}
              height={14}
              className={`shrink-0 text-white transition-opacity duration-200 ${
                isActive ? "opacity-80" : "opacity-40 group-hover:opacity-65"
              }`}
            />
            <span>{tag.label}</span>
          </button>
        );
      })}
    </div>
  );
}
