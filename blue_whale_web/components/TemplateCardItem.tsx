"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./auth/AuthContext";
import type { TemplateCard } from "@/types/template";

export function TemplateCardItem({
  card,
  index,
}: {
  card: TemplateCard;
  index: number;
}) {
  const [hovered, setHovered] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const portrait = card.layout === "portrait";
  const social = card.layout === "social";
  const image = card.layout === "image";

  const handleMouseEnter = () => {
    setHovered(true);
    videoRef.current?.play().catch(() => {});
  };
  const handleMouseLeave = () => {
    setHovered(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  };

  const router = useRouter();
  const { requireAuth } = useAuth();
  const handleSelect = () => {
    requireAuth({ kind: "template-select", prompt: card.title }, () =>
      router.push(`/canvas?prompt=${encodeURIComponent(card.title)}`),
    );
  };

  const cardShape = social
    ? "aspect-[9/16] w-[180px] shrink-0"
    : "aspect-video w-full";
  const titleWrap = social ? "z-30 px-2.5 pt-1.5" : "z-10 px-3.5 pt-2";
  const titleText = social
    ? "min-h-[2.4em] text-[12px]"
    : "min-h-[2.7em] text-[13px]";

  return (
    <button
      type="button"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleSelect}
      className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl bg-white/[0.03] text-left ${cardShape} transition-[background-color,box-shadow] ease-out hover:bg-white/[0.05] hover:shadow-[0_10px_28px_-12px_rgba(0,0,0,0.45)] animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-300 motion-reduce:animate-none motion-reduce:transition-none`}
      style={{ animationDelay: `${index * 45}ms` }}
    >
      {card.video && (
        <span
          className={`pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-2xl transition-opacity duration-300 ease-out motion-reduce:transition-none ${
            hovered ? "opacity-100" : "opacity-0"
          }`}
        >
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            loop
            playsInline
            preload="none"
            muted
            src={card.video}
          />
        </span>
      )}

      <span
        className={`relative shrink-0 transition-opacity duration-300 ease-out motion-reduce:transition-none ${titleWrap} ${
          hovered && card.video ? "opacity-0" : "opacity-100"
        }`}
      >
        <span
          className={`font-medium text-white/78 line-clamp-2 transition-colors duration-200 group-hover:text-white/95 ${titleText}`}
        >
          {card.title}
        </span>
      </span>

      <span
        className={`pointer-events-none relative min-h-0 flex-1 w-full transition-opacity duration-300 ease-out motion-reduce:transition-none ${
          hovered && card.video ? "opacity-0" : "opacity-100"
        } ${
          social
            ? "flex items-end justify-center overflow-hidden pb-2.5 pt-0.5"
            : portrait || image
              ? "flex items-end justify-center"
              : "flex items-center justify-center"
        }`}
      >
        {social ? (
          <span className="flex origin-bottom scale-[0.94] flex-col items-center justify-center">
            <img
              alt=""
              loading="lazy"
              draggable={false}
              className="relative z-10 aspect-[9/16] w-[86px] shrink-0 -translate-x-[22px] rotate-[-4deg] rounded-[10px] border border-neutral-300/20 object-cover shadow-[0_8px_20px_rgba(0,0,0,0.4)] transition-transform duration-300 ease-out group-hover:-translate-x-[30px] group-hover:rotate-[-7deg] motion-reduce:transition-none sm:w-[94px]"
              src={card.images[0]}
            />
            <img
              alt=""
              loading="lazy"
              draggable={false}
              className="relative z-20 -mt-24 aspect-[9/16] w-[104px] shrink-0 translate-x-[22px] rotate-[7deg] rounded-[11px] border border-neutral-300/20 object-cover shadow-[0_12px_28px_rgba(0,0,0,0.5)] transition-transform duration-300 ease-out group-hover:translate-x-[30px] group-hover:rotate-[10deg] motion-reduce:transition-none sm:-mt-32 sm:w-[114px]"
              src={card.images[1]}
            />
            <img
              alt=""
              loading="lazy"
              draggable={false}
              className="relative z-10 -mt-24 aspect-[9/16] w-[86px] shrink-0 -translate-x-[22px] rotate-[-10deg] rounded-[10px] border border-neutral-300/20 object-cover shadow-[0_8px_20px_rgba(0,0,0,0.4)] transition-transform duration-300 ease-out group-hover:-translate-x-[30px] group-hover:rotate-[-13deg] motion-reduce:transition-none sm:-mt-[7.75rem] sm:w-[94px]"
              src={card.images[2]}
            />
          </span>
        ) : image ? (
          <span className="flex items-center justify-center translate-y-[8%]">
            <img
              alt=""
              loading="lazy"
              draggable={false}
              className="shrink-0 rounded-[10px] border border-neutral-300/20 object-cover shadow-[0_8px_20px_rgba(0,0,0,0.35)] transition-transform duration-300 ease-out motion-reduce:transition-none aspect-[3/4] w-[63px] translate-x-4 rotate-[-9deg] sm:w-[78px] group-hover:-translate-y-1 group-hover:rotate-[-12deg]"
              src={card.images[0]}
            />
            <img
              alt=""
              loading="lazy"
              draggable={false}
              className="shrink-0 rounded-[10px] border border-neutral-300/20 object-cover shadow-[0_10px_24px_rgba(0,0,0,0.45)] transition-transform duration-300 ease-out motion-reduce:transition-none relative z-10 aspect-[3/4] w-[72px] sm:w-[90px] group-hover:-translate-y-1.5"
              src={card.images[1]}
            />
            <img
              alt=""
              loading="lazy"
              draggable={false}
              className="shrink-0 rounded-[10px] border border-neutral-300/20 object-cover shadow-[0_8px_20px_rgba(0,0,0,0.35)] transition-transform duration-300 ease-out motion-reduce:transition-none aspect-[3/4] w-[63px] -translate-x-4 rotate-[9deg] sm:w-[78px] group-hover:-translate-y-1 group-hover:rotate-[12deg]"
              src={card.images[2]}
            />
          </span>
        ) : portrait ? (
          <span className="flex items-center justify-center translate-y-[8%]">
            <img
              alt=""
              loading="lazy"
              draggable={false}
              className="shrink-0 rounded-[10px] border border-neutral-300/20 object-cover shadow-[0_8px_20px_rgba(0,0,0,0.35)] transition-transform duration-300 ease-out motion-reduce:transition-none h-[84px] w-[58px] translate-x-4 rotate-[-9deg] sm:h-[108px] sm:w-[76px] group-hover:-translate-y-1 group-hover:rotate-[-12deg]"
              src={card.images[0]}
            />
            <img
              alt=""
              loading="lazy"
              draggable={false}
              className="shrink-0 rounded-[10px] border border-neutral-300/20 object-cover shadow-[0_10px_24px_rgba(0,0,0,0.45)] transition-transform duration-300 ease-out motion-reduce:transition-none relative z-10 h-[94px] w-[66px] sm:h-[118px] sm:w-[82px] group-hover:-translate-y-1.5"
              src={card.images[1]}
            />
            <img
              alt=""
              loading="lazy"
              draggable={false}
              className="shrink-0 rounded-[10px] border border-neutral-300/20 object-cover shadow-[0_8px_20px_rgba(0,0,0,0.35)] transition-transform duration-300 ease-out motion-reduce:transition-none h-[84px] w-[58px] -translate-x-4 rotate-[9deg] sm:h-[108px] sm:w-[76px] group-hover:-translate-y-1 group-hover:rotate-[12deg]"
              src={card.images[2]}
            />
          </span>
        ) : (
          <span className="flex items-center justify-center">
            <img
              alt=""
              loading="lazy"
              draggable={false}
              className="shrink-0 rounded-[10px] border border-neutral-300/20 object-cover shadow-[0_8px_20px_rgba(0,0,0,0.35)] transition-transform duration-300 ease-out motion-reduce:transition-none aspect-video w-[100px] translate-x-7 rotate-[-8deg] sm:w-[118px] group-hover:-translate-y-1 group-hover:rotate-[-11deg]"
              src={card.images[0]}
            />
            <img
              alt=""
              loading="lazy"
              draggable={false}
              className="shrink-0 rounded-[10px] border border-neutral-300/20 object-cover shadow-[0_10px_24px_rgba(0,0,0,0.45)] transition-transform duration-300 ease-out motion-reduce:transition-none relative z-20 -mx-9 aspect-video w-[132px] sm:-mx-11 sm:w-[158px] group-hover:-translate-y-1.5"
              src={card.images[1]}
            />
            <img
              alt=""
              loading="lazy"
              draggable={false}
              className="shrink-0 rounded-[10px] border border-neutral-300/20 object-cover shadow-[0_8px_20px_rgba(0,0,0,0.35)] transition-transform duration-300 ease-out motion-reduce:transition-none aspect-video w-[100px] -translate-x-7 rotate-[8deg] sm:w-[118px] group-hover:-translate-y-1 group-hover:rotate-[11deg]"
              src={card.images[2]}
            />
          </span>
        )}
      </span>
    </button>
  );
}
