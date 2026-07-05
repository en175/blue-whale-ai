"use client";

import { useState, useRef } from "react";

interface Card {
  title: string;
  video: string;
  images: [string, string, string];
}

const CARDS: Card[] = [
  {
    title: "为这款产品创作一条 UGC 广告",
    video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/-mpzxI3neDx6RPHe.mp4",
    images: [
      "https://dj5nb01yl89hl.cloudfront.net/media/images/FE_KPAFDu3_1pSmz.webp",
      "https://dj5nb01yl89hl.cloudfront.net/media/images/5xZj1ipYwfJ2Jqc_.webp",
      "https://dj5nb01yl89hl.cloudfront.net/media/images/G_FZ4A6ZT9P22LMm.webp",
    ],
  },
  {
    title: "批量制作 10 条 UGC 带货广告",
    video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/nsycXrxRW2m5mMlT.mp4",
    images: [
      "https://dj5nb01yl89hl.cloudfront.net/media/images/9kFOn0lb6hS6iaXh.webp",
      "https://dj5nb01yl89hl.cloudfront.net/media/images/DLgyrYhQzEOEOlub.webp",
      "https://dj5nb01yl89hl.cloudfront.net/media/images/uYejUwXFI6kXmyw-.webp",
    ],
  },
  {
    title: "复刻这条爆款产品广告",
    video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/h-X9dnFvhDTTDBkP.mp4",
    images: [
      "https://dj5nb01yl89hl.cloudfront.net/media/images/9uePP4nYY3AgCGv_.webp",
      "https://dj5nb01yl89hl.cloudfront.net/media/images/6jlOXdNzAKXJuHsZ.webp",
      "https://dj5nb01yl89hl.cloudfront.net/media/images/v6Waw_zcXtavbM2v.webp",
    ],
  },
  {
    title: "将商品链接制作成宣传视频",
    video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/mLXY1VGSVMZNrH9Q.mp4",
    images: [
      "https://dj5nb01yl89hl.cloudfront.net/media/images/Zgi6Lycj1HnnrNxg.webp",
      "https://dj5nb01yl89hl.cloudfront.net/media/images/n0jNm5MblskBnAw5.webp",
      "https://dj5nb01yl89hl.cloudfront.net/media/images/Cyj815TQRkO2oQNZ.webp",
    ],
  },
  {
    title: "制作一条电影感 TVC 品牌广告",
    video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/LjhhcvHLHgA-MVYf.mp4",
    images: [
      "https://dj5nb01yl89hl.cloudfront.net/media/images/i93ZgDkJEps7epld.webp",
      "https://dj5nb01yl89hl.cloudfront.net/media/images/qsmne3iarr9MWE6o.webp",
      "https://dj5nb01yl89hl.cloudfront.net/media/images/AyZO2JThG8uDovUL.webp",
    ],
  },
  {
    title: "为这套穿搭创作虚拟试穿视频",
    video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/ceFVpO2BdXf2lwHk.mp4",
    images: [
      "https://dj5nb01yl89hl.cloudfront.net/media/images/jzekLVhMO34tTkYx.webp",
      "https://dj5nb01yl89hl.cloudfront.net/media/images/r8Dw6RhjZM1FkCIv.webp",
      "https://dj5nb01yl89hl.cloudfront.net/media/images/5OWTYORTLl88jOSJ.webp",
    ],
  },
  {
    title: "为我的餐厅制作一条介绍视频",
    video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/rcZ2ANm3UZ-pIjbZ.mp4",
    images: [
      "https://dj5nb01yl89hl.cloudfront.net/media/images/UX1Wpr8ewZNJCQT6.webp",
      "https://dj5nb01yl89hl.cloudfront.net/media/images/TzaJpgmaMpXCx4RG.webp",
      "https://dj5nb01yl89hl.cloudfront.net/media/images/iwok04AOcwZw7buj.webp",
    ],
  },
  {
    title: "围绕我的产品讲述创意迷你故事",
    video: "https://dj5nb01yl89hl.cloudfront.net/media/videos/_9_KDNonFOJHeGXC.mp4",
    images: [
      "https://dj5nb01yl89hl.cloudfront.net/media/images/_zApAwlJrwvOAcPZ.webp",
      "https://dj5nb01yl89hl.cloudfront.net/media/images/axJySYoruc-wE6OR.webp",
      "https://dj5nb01yl89hl.cloudfront.net/media/images/sKmP5bOxwRd56yTz.webp",
    ],
  },
];

function TemplateCard({ card, index }: { card: Card; index: number }) {
  const [hovered, setHovered] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

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

  return (
    <button
      type="button"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl bg-white/[0.03] text-left aspect-video w-full transition-[background-color,box-shadow] ease-out hover:bg-white/[0.05] hover:shadow-[0_10px_28px_-12px_rgba(0,0,0,0.45)] animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-300 motion-reduce:animate-none motion-reduce:transition-none"
      style={{ animationDelay: `${index * 45}ms` }}
    >
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
          preload="auto"
          muted
          src={card.video}
        />
      </span>

      <span
        className={`relative shrink-0 transition-opacity duration-300 ease-out motion-reduce:transition-none z-10 px-3.5 pt-2 ${
          hovered ? "opacity-0" : "opacity-100"
        }`}
      >
        <span className="font-medium text-white/78 line-clamp-2 transition-colors duration-200 group-hover:text-white/95 min-h-[2.7em] text-[13px]">
          {card.title}
        </span>
      </span>

      <span
        className={`pointer-events-none relative min-h-0 flex-1 w-full flex items-center justify-center transition-opacity duration-300 ease-out motion-reduce:transition-none ${
          hovered ? "opacity-0" : "opacity-100"
        }`}
      >
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
      </span>
    </button>
  );
}

export default function TemplateCards() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {CARDS.map((card, idx) => (
        <TemplateCard key={card.title} card={card} index={idx} />
      ))}
    </div>
  );
}
