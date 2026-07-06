"use client";

import { Megaphone, Clapperboard, Copy, Share2, Image } from "lucide-react";

const TAGS = [
  { id: "marketing", label: "营销视频", icon: Megaphone },
  { id: "short", label: "微短片", icon: Clapperboard },
  { id: "replicate", label: "视频复刻", icon: Copy },
  { id: "social", label: "社媒视频", icon: Share2 },
  { id: "image", label: "图片设计", icon: Image },
];

export default function QuickTags({
  active,
  onSelect,
}: {
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="ncs-thin-scrollbar flex w-full items-center justify-center gap-1.5 overflow-x-auto">
      {TAGS.map((tag) => {
        const Icon = tag.icon;
        const isActive = active === tag.id;
        return (
          <button
            key={tag.id}
            type="button"
            onClick={() => onSelect(tag.id)}
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

