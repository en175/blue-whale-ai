"use client";

import { useState, useCallback, useRef, useEffect, useMemo, useLayoutEffect, useId, Suspense } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowLeftRight,
  AtSign,
  AudioLines,
  BookOpenText,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  GalleryVerticalEnd,
  Image as ImageIcon,
  Info,
  Lightbulb,
  MessageSquare,
  Minus,
  MoreHorizontal,
  Paintbrush,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Scan,
  Settings,
  Settings2,
  Shuffle,
  SquarePlus,
  Trash2,
  Type,
  Video,
  X,
} from "lucide-react";
import { SmoothCorners } from "@/components/SmoothCorners";
import SkillPanel from "@/components/SkillPanel";
import { ImageModelSettingsPopover, IMAGE_MODELS, IMAGE_RESOLUTIONS, IMAGE_ASPECT_RATIOS } from "@/components/ImageModelSettingsPopover";
import { AspectRatioIcon } from "@/components/icons/AspectRatioIcon";

// ---------- Types ----------

type ToolDef = {
  id: string;
  label: string;
  icon: React.ReactNode;
  divider?: boolean;
};

type NodeType = "image" | "text";

type NodeItem = {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  content?: string;
  imageUrl?: string;
  selected?: boolean;
};

// 画布素材带入 Dock 时使用的素材形状
type DockMediaItem = {
  id: string;
  type: "image" | "video" | "audio";
  name: string;
  src?: string;
};

type Viewport = {
  x: number;
  y: number;
  scale: number;
};

type ChatMessage =
  | { id: number | string; type: "user"; text: string }
  | { id: number | string; type: "agent"; text: string }
  | { id: number | string; type: "thinking"; text: string; content: string }
  | { id: number | string; type: "card"; text: string; meta: string; collapsed?: boolean; status?: "failed" | "normal" };

const TOOLBAR_PANEL_PATH =
  "M 18 0 L 30 0 c 7.4995 0 11.2492 0 13.8779 1.9098 a 10 10 0 0 1 2.2123 2.2123 c 1.9098 2.6287 1.9098 6.3784 1.9098 13.8779 L 48 18 L 48 272 c 0 7.4995 0 11.2492 -1.9098 13.8779 a 10 10 0 0 1 -2.2123 2.2123 c -2.6287 1.9098 -6.3784 1.9098 -13.8779 1.9098 L 30 290 L 18 290 c -7.4995 0 -11.2492 0 -13.8779 -1.9098 a 10 10 0 0 1 -2.2123 -2.2123 c -1.9098 -2.6287 -1.9098 -6.3784 -1.9098 -13.8779 L 0 272 L 0 18 c 0 -7.4995 0 -11.2492 1.9098 -13.8779 a 10 10 0 0 1 2.2123 -2.2123 c 2.6287 -1.9098 6.3784 -1.9098 13.8779 -1.9098 Z";

const TOOLBAR_BUTTON_PATH =
  "M 10.8 0 L 21.2 0 c 4.4997 0 6.7495 0 8.3267 1.1459 a 6 6 0 0 1 1.3274 1.3274 c 1.1459 1.5772 1.1459 3.827 1.1459 8.3267 L 32 10.8 L 32 21.2 c 0 4.4997 0 6.7495 -1.1459 8.3267 a 6 6 0 0 1 -1.3274 1.3274 c -1.5772 1.1459 -3.827 1.1459 -8.3267 1.1459 L 21.2 32 L 10.8 32 c -4.4997 0 -6.7495 0 -8.3267 -1.1459 a 6 6 0 0 1 -1.3274 -1.3274 c -1.1459 -1.5772 -1.1459 -3.827 -1.1459 -8.3267 L 0 21.2 L 0 10.8 c 0 -4.4997 0 -6.7495 1.1459 -8.3267 a 6 6 0 0 1 1.3274 -1.3274 c 1.5772 -1.1459 3.827 -1.1459 8.3267 -1.1459 Z";

function squirclePath(width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height / 2);
  const w = width;
  const h = height;
  const c1 = r * 0.416638;
  const c2 = r * 0.624955;
  const c3 = r * 0.770994;
  const c4 = r * 0.1061;
  const arcR = r * 0.555555;
  const arcD = r * 0.122794;
  const c6 = r * 0.146038;
  const c7 = r * 0.354355;
  return [
    `M ${r} 0`,
    `L ${w - r} 0`,
    `c ${c1} 0 ${c2} 0 ${c3} ${c4}`,
    `a ${arcR} ${arcR} 0 0 1 ${arcD} ${arcD}`,
    `c ${c4} ${c6} ${c4} ${c7} ${c4} ${c3}`,
    `L ${w} ${h - r}`,
    `c 0 ${c1} 0 ${c2} ${-c4} ${c3}`,
    `a ${arcR} ${arcR} 0 0 1 ${-arcD} ${arcD}`,
    `c ${-c6} ${c4} ${-c7} ${c4} ${-c3} ${c4}`,
    `L ${r} ${h}`,
    `c ${-c1} 0 ${-c2} 0 ${-c3} ${-c4}`,
    `a ${arcR} ${arcR} 0 0 1 ${-arcD} ${-arcD}`,
    `c ${-c4} ${-c6} ${-c4} ${-c7} ${-c4} ${-c3}`,
    `L 0 ${r}`,
    `c 0 ${-c1} 0 ${-c2} ${c4} ${-c3}`,
    `a ${arcR} ${arcR} 0 0 1 ${arcD} ${-arcD}`,
    `c ${c6} ${-c4} ${c7} ${-c4} ${c3} ${-c4}`,
    "Z",
  ].join(" ");
}

function UserMessageBubble({ text }: { text: string }) {
  return (
    <div className="self-end max-w-[82%] whitespace-pre-wrap break-words rounded-[18px] border border-white/[0.04] bg-white/[0.1] px-3.5 py-2 text-[13px] leading-normal text-white/[0.9]">
      {text}
    </div>
  );
}

function AgentMessageBubble({ text }: { text: string }) {
  const segments = text.split("\n\n");
  while (segments.length > 0 && segments[segments.length - 1] === "") {
    segments.pop();
  }
  let nonEmptyIndex = 0;
  return (
    <div className="self-start max-w-[92%] whitespace-pre-wrap break-words rounded-[12px] rounded-bl-[2px] px-2.5 py-2 text-[13px] font-normal leading-[21px] text-white/[0.9]">
      {segments.map((segment, i) => {
        if (segment === "") {
          return <div key={i} style={{ height: 8 }} />;
        }
        const isFirst = nonEmptyIndex === 0;
        nonEmptyIndex += 1;
        return (
          <div key={i} style={{ marginTop: isFirst ? 0 : 2 }}>
            {segment}
          </div>
        );
      })}
    </div>
  );
}

function ThinkingBlock({ msg }: { msg: Extract<ChatMessage, { type: "thinking" }> }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="tc-agent-thinking-block self-start">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className={[
          "tc-agent-thinking-trigger inline-flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.04] px-2.5 py-1 text-xs text-white/70 transition-colors hover:bg-white/[0.06]",
          expanded ? "tc-agent-thinking-trigger--expanded" : "",
        ].join(" ")}
      >
        <span className="tc-agent-thinking-trigger__label">{msg.text}</span>
        <ChevronRight
          width={13}
          height={13}
          className={["tc-agent-thinking-trigger__icon", expanded ? "rotate-90" : ""].join(" ")}
        />
      </button>
      {expanded && (
        <div className="tc-agent-thinking-content-wrap">
          <div className="tc-agent-thinking-content" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {msg.content}
          </div>
          <div className="tc-agent-thinking-scrollbar" aria-hidden="true">
            <div className="tc-agent-thinking-scrollbar__thumb" />
          </div>
        </div>
      )}
    </div>
  );
}

function AgentCard({ msg }: { msg: Extract<ChatMessage, { type: "card" }> }) {
  const [collapsed, setCollapsed] = useState(msg.collapsed ?? false);
  const maskId = useId().replace(/:/g, "");
  const failed = msg.status === "failed";
  return (
    <div className="self-stretch">
      <div className="flex flex-col gap-2 rounded-xl border border-[var(--tc-border-subtle,rgba(255,255,255,0.08))] bg-white/[0.03] p-3 text-xs leading-normal text-white/[0.92]">
        <div className="flex items-center justify-between gap-2">
          <div className="tc-agent-card-header-leading">
            <span className="tc-agent-card-badge">
              <ImageIcon width={13} height={13} stroke="currentColor" strokeWidth={1.8} />
            </span>
          </div>
          <div className="tc-agent-card-header-actions">
            <span className="tc-agent-card-meta">
              <span style={{ color: "rgba(255,255,255,0.55)" }}>{msg.meta}</span>
            </span>
            <button
              type="button"
              className={[
                "tc-agent-card-cta tc-agent-card-cta--reapply",
                failed ? "tc-agent-card-cta--reapply-failed" : "",
                "inline-flex items-center gap-1 rounded-md bg-white/[0.08] px-2 py-1 text-xs text-white/80 transition-colors hover:bg-white/[0.12]",
              ].join(" ")}
              data-tooltip={failed ? "积分不足，请升级套餐以继续使用。" : undefined}
              aria-label={failed ? "积分不足，请升级套餐以继续使用。" : "手动应用"}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width={12} height={12} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <defs>
                  <mask id={`tc-agent-card-reapply-plus-${maskId}`} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
                    <rect x="0" y="0" width="24" height="24" fill="black" />
                    <path d="M5 12h14" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M12 5v14" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </mask>
                </defs>
                <rect x="0" y="0" width="24" height="24" fill="currentColor" mask={`url(#tc-agent-card-reapply-plus-${maskId})`} />
              </svg>
              <span className="tc-agent-card-cta__label">手动应用</span>
            </button>
            <button
              type="button"
              className="tc-agent-card-collapse-btn inline-flex h-6 w-6 items-center justify-center rounded-md text-white/50 transition-colors hover:bg-white/[0.06]"
              aria-expanded={!collapsed}
              aria-label="折叠卡片"
              title="折叠卡片"
              onClick={() => setCollapsed((v) => !v)}
            >
              {collapsed ? <ChevronDown width={14} height={14} /> : <ChevronUp width={14} height={14} />}
            </button>
          </div>
        </div>
        {!collapsed && (
          <div className="break-words" style={{ overflowWrap: "anywhere" }}>
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Icons ----------

function TopviewLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={28}
      height={28}
      viewBox="0 0 210 210"
      fill="none"
      className={className}
    >
      <path
        d="M162 0C188.51 0 210 21.4905 210 48V162C210 188.51 188.51 210 162 210H48C21.4903 210 0 188.51 0 162V48C0.000166991 21.4905 21.4904 0 48 0H162ZM161.586 69.124C161.556 69.1758 134.717 116.108 128.961 116.008C123.202 115.907 110.372 90.457 110.372 90.457C110.28 90.6044 84.343 131.966 79.5771 132.879C74.8031 133.799 74.6333 114.812 66.125 114.416C57.6174 114.013 36.9155 152.357 36.9111 152.365L46.6514 168.272L70.5635 132.722C70.5732 132.751 76.9933 152.315 89.2393 153.278C101.495 154.242 119.117 120.336 119.117 120.336C119.117 120.336 130.48 143.758 138.443 146.644C146.396 149.531 176.822 95.2796 176.911 95.1211L161.586 69.124ZM77.7305 36.3477C77.7303 52.0516 65.3453 64.9004 50.209 64.9004C65.3454 64.9004 77.7305 77.7491 77.7305 93.4531C77.7305 77.7491 90.1145 64.9004 105.251 64.9004C90.1146 64.9004 77.7306 52.0516 77.7305 36.3477Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M10 2.5H7.83333C5.96649 2.5 5.03307 2.5 4.32003 2.86331C3.69282 3.18289 3.18289 3.69282 2.86331 4.32003C2.5 5.03307 2.5 5.96649 2.5 7.83333V12.1667C2.5 14.0335 2.5 14.9669 2.86331 15.68C3.18289 16.3072 3.69282 16.8171 4.32003 17.1367C5.03307 17.5 5.96649 17.5 7.83333 17.5H12.7781C14.0706 17.5 14.7169 17.5 15.2379 17.3232C16.2194 16.9901 16.9901 16.2194 17.3232 15.2379C17.5 14.7169 17.5 14.0706 17.5 12.7781C17.5 11.9639 17.5 11.5568 17.3791 11.3022C17.1495 10.819 16.6379 10.5355 16.1065 10.5969C15.8265 10.6293 15.4813 10.845 14.7908 11.2766L12.4074 12.7662C11.4659 13.3547 10.2544 13.2796 9.39267 12.5795C8.32861 11.7149 6.77584 11.8262 5.84591 12.8336L5 13.75"
        stroke="currentColor"
        strokeOpacity={0.8}
        strokeLinecap="round"
      />
      <path
        d="M15.8088 1.37075C15.8143 1.34386 15.8528 1.34386 15.8583 1.37075C16.1435 2.76615 17.234 3.85665 18.6294 4.14186C18.6562 4.14735 18.6562 4.18577 18.6294 4.19126C17.234 4.47647 16.1435 5.56697 15.8583 6.96237C15.8528 6.98925 15.8143 6.98925 15.8088 6.96237C15.5236 5.56697 14.4331 4.47647 13.0377 4.19126C13.0109 4.18577 13.0109 4.14735 13.0377 4.14186C14.4331 3.85665 15.5236 2.76615 15.8088 1.37075Z"
        stroke="currentColor"
        strokeOpacity={0.8}
      />
      <path
        d="M7.5 7.5V7.54167"
        stroke="currentColor"
        strokeOpacity={0.8}
        strokeWidth={1.66667}
        strokeLinecap="round"
      />
    </svg>
  );
}

function VideoGenIcon({ className }: { className?: string }) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M15.392 12.3211C15.3975 12.2942 15.4359 12.2942 15.4414 12.3211C15.7266 13.7165 16.8171 14.807 18.2125 15.0922C18.2394 15.0977 18.2394 15.1361 18.2125 15.1416C16.8171 15.4268 15.7266 16.5173 15.4414 17.9127C15.4359 17.9396 15.3975 17.9396 15.392 17.9127C15.1068 16.5173 14.0163 15.4268 12.6209 15.1416C12.594 15.1361 12.594 15.0977 12.6209 15.0922C14.0163 14.807 15.1068 13.7165 15.392 12.3211Z"
        stroke="currentColor"
        strokeOpacity={0.8}
      />
      <path
        d="M2.49994 7.91643V7.41643H1.99994V7.91643H2.49994ZM17.8333 10.8331C17.8333 11.1092 18.0571 11.3331 18.3333 11.3331C18.6094 11.3331 18.8333 11.1092 18.8333 10.8331H18.3333H17.8333ZM10.6249 17.9998C10.9011 17.9998 11.1249 17.7759 11.1249 17.4998C11.1249 17.2236 10.9011 16.9998 10.6249 16.9998V17.4998V17.9998ZM2.52901 7.59605L2.0366 7.68288L2.12343 8.17528L2.61583 8.08846L2.52901 7.59605Z"
        fill="currentColor"
        fillOpacity={0.8}
      />
      <path
        d="M16.8908 5.06368L16.804 4.57128L2.44218 7.10365L2.52901 7.59605L2.61583 8.08846L16.9776 5.55609L16.8908 5.06368Z"
        fill="currentColor"
        fillOpacity={0.8}
      />
      <path
        d="M13.4423 2.07005C13.5089 1.80207 13.3457 1.53081 13.0777 1.46418C12.8097 1.39755 12.5384 1.56078 12.4718 1.82876L12.957 1.94941L13.4423 2.07005ZM11.4816 5.8112C11.415 6.07919 11.5782 6.35045 11.8462 6.41708C12.1142 6.4837 12.3855 6.32048 12.4521 6.05249L11.9669 5.93185L11.4816 5.8112ZM8.51822 2.93829C8.58484 2.67031 8.42162 2.39905 8.15363 2.33242C7.88565 2.26579 7.61439 2.42902 7.54776 2.697L8.03299 2.81765L8.51822 2.93829ZM6.5576 6.67945C6.49097 6.94743 6.6542 7.21869 6.92218 7.28532C7.19016 7.35195 7.46142 7.18872 7.52805 6.92073L7.04282 6.80009L6.5576 6.67945Z"
        fill="currentColor"
        fillOpacity={0.8}
      />
      <path
        d="M15.0086 1.58772L15.0954 2.08012C16.1832 1.88831 17.2205 2.61465 17.4123 3.70244L17.9047 3.61561L18.3971 3.52879C18.1094 1.89711 16.5535 0.807601 14.9218 1.09531L15.0086 1.58772Z"
        fill="currentColor"
        fillOpacity={0.8}
      />
      <path
        d="M5.57085 3.25184L5.48403 2.75944C4.91719 2.85939 4.46735 2.93843 4.10774 3.02745C3.74375 3.11755 3.43665 3.22582 3.16207 3.40075L3.43072 3.82244L3.69937 4.24414C3.84418 4.15188 4.03357 4.07599 4.34802 3.99815C4.66683 3.91923 5.07736 3.84657 5.65768 3.74425L5.57085 3.25184Z"
        fill="currentColor"
        fillOpacity={0.8}
      />
      <path
        d="M2.52901 7.59605L3.02141 7.50923C2.91908 6.92891 2.84695 6.51829 2.81207 6.19171C2.77767 5.86961 2.78421 5.66568 2.82137 5.49804L2.33322 5.38982L1.84508 5.2816C1.77461 5.59946 1.7779 5.92507 1.81773 6.29792C1.85707 6.66629 1.93665 7.11604 2.0366 7.68288L2.52901 7.59605ZM3.43072 3.82244L3.16207 3.40075C2.49102 3.82825 2.01729 4.50481 1.84508 5.2816L2.33322 5.38982L2.82137 5.49804C2.93618 4.98018 3.252 4.52914 3.69937 4.24414L3.43072 3.82244Z"
        fill="currentColor"
        fillOpacity={0.8}
      />
    </svg>
  );
}

function SelectIcon({ className }: { className?: string }) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M4.58594 4.58594C5.14848 4.02339 5.99097 3.84779 6.73145 4.13867L19.7314 9.24609C20.5224 9.55694 21.0311 10.3334 20.999 11.1826C20.9668 12.0321 20.4004 12.7686 19.5879 13.0186C19.5705 13.0239 19.5529 13.0288 19.5352 13.0332L14.3252 14.3252L13.0332 19.5352C13.0288 19.5529 13.0239 19.5705 13.0186 19.5879C12.7686 20.4004 12.0321 20.9668 11.1826 20.999C10.3334 21.0311 9.55694 20.5224 9.24609 19.7314L4.13867 6.73145C3.84779 5.99097 4.02339 5.14848 4.58594 4.58594ZM6.36523 5.06934C5.99509 4.92411 5.57414 5.01179 5.29297 5.29297L5.19629 5.4043C4.99309 5.67831 4.94226 6.04136 5.06934 6.36523L10.1768 19.3652C10.3128 19.7115 10.6271 19.95 10.9883 19.9932L11.1455 19.999C11.5701 19.9827 11.9375 19.7 12.0625 19.2939L13.5 13.5L19.2939 12.0625C19.6493 11.9532 19.9109 11.6583 19.9814 11.3018L19.999 11.1455C20.0131 10.7738 19.8204 10.4294 19.5068 10.2451L19.3652 10.1768L6.36523 5.06934Z"
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  );
}

function CreditIcon({ size = 14 }: { size?: number }) {
  return (
    <img
      alt="Credits"
      width={size}
      height={size}
      draggable={false}
      src="https://d1735p3aqhycef.cloudfront.net/topview/ic_credit.svg"
      className="block shrink-0 pointer-events-none"
      style={{ opacity: 0.4 }}
    />
  );
}

function MaskIcon({
  size = 16,
  viewBox = 24,
  maskChildren,
  ariaHidden = true,
}: {
  size?: number;
  viewBox?: number;
  maskChildren: React.ReactNode;
  ariaHidden?: boolean;
}) {
  const id = useMemo(() => `mask-${Math.random().toString(36).slice(2, 9)}`, []);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${viewBox} ${viewBox}`}
      fill="none"
      aria-hidden={ariaHidden}
    >
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width={viewBox} height={viewBox}>
          <rect x="0" y="0" width={viewBox} height={viewBox} fill="black" />
          {maskChildren}
        </mask>
      </defs>
      <rect x="0" y="0" width={viewBox} height={viewBox} fill="currentColor" mask={`url(#${id})`} />
    </svg>
  );
}

function IconClose({ size = 16 }: { size?: number }) {
  return (
    <MaskIcon size={size} maskChildren={
      <>
        <path d="M18 6 6 18" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m6 6 12 12" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    } />
  );
}

function IconPlus({ size = 16 }: { size?: number }) {
  return (
    <MaskIcon size={size} maskChildren={
      <>
        <path d="M5 12h14" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 5v14" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </>
    } />
  );
}

function IconSend({ size = 14 }: { size?: number }) {
  return (
    <MaskIcon size={size} maskChildren={
      <>
        <path d="M12 19V5" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m5 12 7-7 7 7" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    } />
  );
}

// ---------- Components ----------

type Project = {
  id: string;
  name: string;
  thumb: string | null;
  active?: boolean;
};

const PROJECTS: Project[] = [
  {
    id: "1",
    name: "2026-06-30 09:54",
    thumb: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=120&h=120&fit=crop",
    active: true,
  },
  {
    id: "2",
    name: "2026-06-29 16:13",
    thumb: "https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?w=120&h=120&fit=crop",
  },
  {
    id: "3",
    name: "2026-06-26 03:18",
    thumb: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=120&h=120&fit=crop",
  },
  { id: "4", name: "2026-06-25 16:51", thumb: null },
];

function ProjectMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      className="tc-project-menu"
      style={{
        position: "absolute",
        top: "calc(100% + 2px)",
        left: 0,
        zIndex: 300,
        width: 280,
        borderRadius: 8,
        border: "1px solid rgba(255, 255, 255, 0.04)",
        background: "rgb(30, 30, 30)",
        padding: "4px 8px 8px",
        boxShadow: "rgba(0, 0, 0, 0.4) 0px 8px 24px",
      }}
    >
      <div
        style={{
          padding: "8px 16px 4px",
          fontSize: 11,
          color: "rgba(255, 255, 255, 0.4)",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}
      >
        Projects
      </div>
      <div style={{ maxHeight: 240, overflowY: "auto", margin: "4px 0" }}>
        {PROJECTS.map((p) => (
          <div
            key={p.id}
            className="group/project relative flex items-center"
            style={{
              padding: "6px 16px",
              borderRadius: 6,
              background: p.active ? "rgba(255, 255, 255, 0.12)" : "transparent",
            }}
          >
            <button
              type="button"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flex: "1 1 0%",
                minWidth: 0,
                padding: 0,
                background: "none",
                border: 0,
                outline: "none",
                cursor: "pointer",
                textAlign: "left",
                color: p.active ? "rgb(255, 255, 255)" : "rgba(255, 255, 255, 0.7)",
                fontSize: 14,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  flexShrink: 0,
                  borderRadius: 6,
                  overflow: "hidden",
                  background: "rgba(255, 255, 255, 0.06)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {p.thumb ? (
                  <img
                    alt=""
                    src={p.thumb}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                ) : (
                  <svg
                    width={14}
                    height={14}
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    aria-hidden="true"
                    style={{ opacity: 0.35, flexShrink: 0 }}
                  >
                    <line x1="5" y1="1" x2="5" y2="15" />
                    <line x1="11" y1="1" x2="11" y2="15" />
                    <line x1="1" y1="5" x2="15" y2="5" />
                    <line x1="1" y1="11" x2="15" y2="11" />
                  </svg>
                )}
              </div>
              <span
                style={{
                  flex: "1 1 0%",
                  minWidth: 0,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  fontWeight: p.active ? 600 : 400,
                  WebkitMaskImage:
                    "linear-gradient(to right, black calc(100% - 12px), transparent calc(100% + 0px))",
                  maskImage:
                    "linear-gradient(to right, black calc(100% - 12px), transparent calc(100% + 0px))",
                  transition: "mask-image 0.1s, -webkit-mask-image 0.1s",
                }}
              >
                {p.name}
              </span>
            </button>
            <button
              type="button"
              aria-label="Delete project"
              className="opacity-0 pointer-events-none group-hover/project:opacity-100 group-hover/project:pointer-events-auto"
              style={{
                position: "absolute",
                right: 12,
                top: "50%",
                transform: "translateY(-50%)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                height: 24,
                width: 24,
                background: "rgba(239, 68, 68, 0.12)",
                border: 0,
                borderRadius: 6,
                color: "rgb(239, 68, 68)",
                fontSize: 12,
                cursor: "pointer",
                outline: "none",
                transition: "background 0.1s, color 0.1s, opacity 0.1s",
              }}
            >
              <Trash2 width={14} height={14} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      <div style={{ height: 1, background: "rgba(255, 255, 255, 0.06)", margin: "8px 0" }} />
      <button
        type="button"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          width: "100%",
          padding: "6px 16px",
          fontSize: 14,
          color: "rgba(255, 255, 255, 0.7)",
          background: "none",
          border: 0,
          borderRadius: 6,
          cursor: "pointer",
          textAlign: "left",
          outline: "none",
          transition: "background 0.1s, color 0.1s",
        }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Pencil width={14} height={14} aria-hidden="true" />
        </span>
        Rename Project
      </button>
      <button
        type="button"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          width: "100%",
          padding: "6px 16px",
          fontSize: 14,
          color: "rgba(255, 255, 255, 0.7)",
          background: "none",
          border: 0,
          borderRadius: 6,
          cursor: "pointer",
          textAlign: "left",
          outline: "none",
          transition: "background 0.1s, color 0.1s",
        }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <IconPlus size={16} />
        </span>
        New Project
      </button>
    </div>
  );
}

function TopBar() {
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);

  return (
    <div
      className="tc-top-bar-left tc-enter tc-enter--top tc-enter-d1"
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        zIndex: 150,
        pointerEvents: "auto",
        display: "flex",
        alignItems: "center",
        fontFamily: "Inter, -apple-system, sans-serif",
        gap: 4,
        padding: 2,
        background: "rgba(0, 0, 0, 0.55)",
        backdropFilter: "blur(12px)",
        borderRadius: 10,
      }}
    >
      <div style={{ position: "relative" }}>
        <button
          type="button"
          className="tc-logo-menu-btn"
          aria-label="导航菜单"
          aria-expanded={false}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: 0,
            padding: 0,
            cursor: "pointer",
            outline: "none",
          }}
        >
          <div
            style={{
              transform: "scale(0.85)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <TopviewLogo className="text-white" />
          </div>
        </button>
      </div>
      <div
        style={{
          width: 1,
          height: 14,
          background: "rgba(255, 255, 255, 0.16)",
          flexShrink: 0,
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
        <button
          type="button"
          onClick={() => setProjectMenuOpen((v) => !v)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            maxWidth: 224,
            width: "fit-content",
            minWidth: 0,
            boxSizing: "border-box",
            background: "rgba(42, 42, 45, 0.72)",
            border: 0,
            padding: "4px 8px",
            borderRadius: 8,
            color: "rgb(255, 255, 255)",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            outline: "none",
            transition: "background 120ms",
            overflow: "hidden",
            gap: 4,
          }}
        >
          <span
            style={{
              flex: "0 1 auto",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              textAlign: "left",
            }}
          >
            2026-06-30 09:54
          </span>
          <ChevronDown
            width={14}
            height={14}
            stroke="rgba(255, 255, 255, 0.5)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ flexShrink: 0 }}
          />
        </button>
        <ProjectMenu open={projectMenuOpen} onClose={() => setProjectMenuOpen(false)} />
      </div>
      <div style={{ position: "relative", display: "inline-flex" }}>
        <button
          type="button"
          className="tc-shell-btn tc-top-bar-settings-btn"
          aria-label="系统设置"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: 8,
            background: "transparent",
            border: 0,
            color: "rgba(255, 255, 255, 0.8)",
            cursor: "pointer",
            outline: "none",
            transition: "background 120ms",
          }}
        >
          <Settings
            width={14}
            height={14}
            stroke="rgba(255, 255, 255, 0.8)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  );
}


function TopBarCenter() {
  return null;
}

function TopBarRight({
  isAgentOpen,
  onAgentToggle,
}: {
  isAgentOpen: boolean;
  onAgentToggle: () => void;
}) {
  return (
    <div className="tc-top-bar-right absolute top-4 right-4 z-[100] flex items-center">
      <div className="tc-top-bar-right__actions flex items-center gap-2">
        <button
          type="button"
          onClick={onAgentToggle}
          className="tc-shell-btn tc-shell-btn--labeled inline-flex h-9 items-center gap-1.5 rounded-[18px] bg-[var(--tc-menu-pill-bg)] px-3 text-white border border-[var(--tc-menu-pill-border)] shadow-[var(--tc-menu-pill-shadow)] backdrop-blur-md transition-colors hover:bg-[var(--tc-menu-item-hover)] data-[active]:bg-white/[0.12] data-[active]:border-white/[0.10]"
          aria-label="Canvas Agent"
          data-active={isAgentOpen ? "" : undefined}
        >
          <MessageSquare width={18} height={18} stroke="rgba(255,255,255,0.8)" strokeWidth={1.5} />
          <span className="tc-shell-btn__label text-[13px] font-medium">Agent</span>
        </button>
      </div>
    </div>
  );
}

const LEFT_TOOLS: ToolDef[] = [
  { id: "select", label: "选择", icon: <SelectIcon className="text-white" /> },
  { id: "upload", label: "上传", icon: <SquarePlus width={20} height={20} stroke="rgba(255, 255, 255, 0.8)" strokeWidth={1.5} /> },
  { id: "text", label: "文本", icon: <Type width={20} height={20} stroke="rgba(255, 255, 255, 0.8)" strokeWidth={1.5} />, divider: true },
  { id: "ai-image", label: "AI 图片", icon: <SparkleIcon className="text-white" /> },
  { id: "ai-video", label: "AI 视频", icon: <VideoGenIcon className="text-white" /> },
];

function LeftToolbar({ onToolClick }: { onToolClick?: (id: string) => void }) {
  const toolbarHeight = useMemo(() => {
    return LEFT_TOOLS.reduce((sum, tool, index) => {
      const isLast = index === LEFT_TOOLS.length - 1;
      return sum + 32 + (tool.divider ? 9 : 0) + (isLast ? 0 : 4);
    }, 16);
  }, []);
  const toolbarPath = useMemo(() => squirclePath(48, toolbarHeight, 18), [toolbarHeight]);

  return (
    <aside
      data-tour-target="creation-sidebar"
      className="absolute left-4 top-1/2 z-[150] -translate-y-1/2 pointer-events-none"
    >
      <SmoothCorners
        width={48}
        height={toolbarHeight}
        path={toolbarPath}
        className="tc-enter tc-enter--left tc-enter-d3 pointer-events-auto"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          padding: 8,
          background: "rgb(23, 23, 23)",
        }}
      >
        {LEFT_TOOLS.map((tool) => (
          <div key={tool.id} className="relative flex flex-col items-center gap-1">
            <SmoothCorners
              width={32}
              height={32}
              path={TOOLBAR_BUTTON_PATH}
              overlay={false}
            >
              <button
                type="button"
                aria-label={tool.label}
                onClick={() => onToolClick?.(tool.id)}
                className="tc-ui-glow-btn flex h-[32px] w-[32px] items-center justify-center bg-transparent text-white/95 transition-colors duration-150 hover:bg-white/[0.08]"
              >
                {tool.icon}
              </button>
            </SmoothCorners>
            {tool.divider && (
              <div
                className="shrink-0"
                style={{ width: 24, height: 1, background: "rgba(255, 255, 255, 0.06)", margin: "4px 0" }}
              />
            )}
          </div>
        ))}
      </SmoothCorners>
    </aside>
  );
}

function CanvasBackground() {
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      style={{ opacity: 0.35 }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern id="canvas-dot-pattern" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="0.5" cy="0.5" r="0.5" fill="rgba(255,255,255,0.2)" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#canvas-dot-pattern)" />
    </svg>
  );
}

function ImageNode({
  node,
  selected,
  onPointerDown,
}: {
  node: NodeItem;
  selected?: boolean;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>, node: NodeItem) => void;
}) {
  return (
    <div
      className={[
        "tc-canvas-card-node tc-image-node__media absolute overflow-visible rounded-lg",
        selected ? "z-[110]" : "z-[100]",
      ].join(" ")}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        outline: selected
          ? "2px solid var(--tc-card-selected-stroke, rgba(235, 235, 235, 0.88))"
          : "2px solid transparent",
        outlineOffset: 0,
        backgroundImage:
          "linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 50%, #2a2a2a 100%)",
      }}
      role="img"
      aria-label="图片"
      onPointerDown={(e) => onPointerDown?.(e, node)}
    >
      <div className="absolute -top-6 left-0 flex items-center text-xs font-normal leading-4 select-none" style={{ width: node.width }}>
        <div className="flex min-w-0 flex-1 items-center gap-[5px] text-white/70">
          <ImageIcon width={13} height={13} stroke="currentColor" />
          <span className="tc-node-label-bar__name relative inline-block max-w-[216px] cursor-text overflow-hidden text-ellipsis whitespace-nowrap align-bottom">
            {node.content || "图片节点"}
          </span>
        </div>
      </div>
      {node.imageUrl ? (
        <img
          src={node.imageUrl}
          alt={node.content || "图片"}
          className="h-full w-full object-contain rounded-lg"
          draggable={false}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-white/25">
          <ImageIcon width={48} height={48} stroke="currentColor" strokeWidth={1} />
        </div>
      )}
      {selected && (
        <div className="tc-node-resize-handles">
          <div
            className="tc-node-resize-handle absolute top-0 left-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80"
            data-corner="top-left"
            role="button"
            aria-label="调整图片大小"
          />
          <div
            className="tc-node-resize-handle absolute top-0 right-0 h-2.5 w-2.5 translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80"
            data-corner="top-right"
            role="button"
            aria-label="调整图片大小"
          />
          <div
            className="tc-node-resize-handle absolute bottom-0 left-0 h-2.5 w-2.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-white/80"
            data-corner="bottom-left"
            role="button"
            aria-label="调整图片大小"
          />
          <div
            className="tc-node-resize-handle absolute bottom-0 right-0 h-2.5 w-2.5 translate-x-1/2 translate-y-1/2 rounded-full bg-white/80"
            data-corner="bottom-right"
            role="button"
            aria-label="调整图片大小"
          />
        </div>
      )}
    </div>
  );
}

function TextNode({
  node,
  selected,
  onPointerDown,
}: {
  node: NodeItem;
  selected?: boolean;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>, node: NodeItem) => void;
}) {
  return (
    <div
      className={[
        "tc-canvas-card-node tc-text-node absolute rounded-xl flex items-center justify-center px-4",
        selected ? "z-[110]" : "z-[100]",
      ].join(" ")}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        outline: selected
          ? "2px solid var(--tc-card-selected-stroke, rgba(235, 235, 235, 0.88))"
          : "2px solid transparent",
        outlineOffset: 0,
        background: "rgba(255,255,255,0.06)",
      }}
      onPointerDown={(e) => onPointerDown?.(e, node)}
    >
      <span className="text-sm text-white/90 text-center leading-5">{node.content}</span>
    </div>
  );
}

const NODE_TOOLBAR_ACTIONS = [
  { id: "refresh", label: "重新编辑", icon: <RefreshCw width={16} height={16} className="tc-node-toolbar-icon" /> },
  { id: "shuffle", label: "再创作", icon: <Shuffle width={16} height={16} className="tc-node-toolbar-icon" /> },
  { id: "mention", label: "添加到对话", icon: <AtSign width={16} height={16} className="tc-node-toolbar-icon" /> },
  { id: "divider", label: "", icon: null },
  { id: "video", label: "生成视频", icon: <Video width={16} height={16} className="tc-node-toolbar-icon" /> },
  { id: "paint", label: "局部重绘", icon: <Paintbrush width={16} height={16} className="tc-node-toolbar-icon" />, hidden: true },
  { id: "light", label: "重打光", icon: <Lightbulb width={16} height={16} className="tc-node-toolbar-icon" />, hidden: true },
  { id: "upscale", label: "超分", icon: (
    <svg width={16} height={16} viewBox="96 96 832 832" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="tc-node-toolbar-icon">
      <path d="M309.333333 341.333333a32 32 0 0 1 32 32v117.333334h85.333334V373.333333a32 32 0 0 1 64 0v277.333334a32 32 0 0 1-64 0V554.666667H341.333333v96a32 32 0 0 1-64 0v-277.333334A32 32 0 0 1 309.333333 341.333333zM586.666667 341.333333a32 32 0 0 0-32 32v277.333334c0 17.664 14.336 32 32 32h42.666666A138.666667 138.666667 0 0 0 768 544v-64A138.666667 138.666667 0 0 0 629.333333 341.333333h-42.666666z m32 277.333334v-213.333334h10.666666c41.216 0 74.666667 33.450667 74.666667 74.666667v64a74.666667 74.666667 0 0 1-74.666667 74.666667h-10.666666z"></path>
      <path d="M128 266.666667A138.666667 138.666667 0 0 1 266.666667 128h490.666666A138.666667 138.666667 0 0 1 896 266.666667v490.666666A138.666667 138.666667 0 0 1 757.333333 896H266.666667A138.666667 138.666667 0 0 1 128 757.333333V266.666667zM266.666667 192A74.666667 74.666667 0 0 0 192 266.666667v490.666666c0 41.216 33.450667 74.666667 74.666667 74.666667h490.666666a74.666667 74.666667 0 0 0 74.666667-74.666667V266.666667a74.666667 74.666667 0 0 0-74.666667-74.666667H266.666667z"></path>
    </svg>
  ), hidden: true },
  { id: "divider2", label: "", icon: null },
  { id: "info", label: "信息", icon: <Info width={16} height={16} className="tc-node-toolbar-icon" /> },
  { id: "download", label: "下载", icon: <Download width={16} height={16} className="tc-node-toolbar-icon" /> },
];

function NodeToolbar({ node, onAction }: { node: NodeItem; onAction?: (id: string) => void }) {
  return (
    <div
      className="tc-node-toolbar absolute z-[120] -translate-x-1/2 -translate-y-full rounded-[14px] bg-[#1a1a1a]/95 px-2 py-1.5 flex items-center gap-1 border border-white/[0.08] backdrop-blur-md"
      style={{ left: node.x + node.width / 2, top: node.y - 8 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {NODE_TOOLBAR_ACTIONS.map((action) => {
        if (action.id.startsWith("divider")) {
          return (
            <div
              key={action.id}
              style={{
                width: 1,
                height: 24,
                background: "rgba(255, 255, 255, 0.1)",
                margin: "0px 2px",
                flexShrink: 0,
              }}
            />
          );
        }
        if (action.hidden) return null;
        return (
          <div key={action.id} className="tc-node-toolbar-action" style={{ position: "relative" }}>
            <button
              type="button"
              aria-label={action.label}
              aria-pressed="false"
              aria-expanded="false"
              onClick={() => onAction?.(action.id)}
              className="tc-node-toolbar-button flex items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/[0.08] hover:text-white"
              style={{ width: 32, height: 32, padding: 8, border: 0, background: "transparent", cursor: "pointer" }}
            >
              {action.icon}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function CanvasSurface({
  containerRef,
  viewport,
  nodes,
  selectedId,
  setViewport,
  setNodes,
  setSelectedId,
  onNodeAction,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  viewport: Viewport;
  nodes: NodeItem[];
  selectedId: string | null;
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
  setNodes: React.Dispatch<React.SetStateAction<NodeItem[]>>;
  setSelectedId: (id: string | null) => void;
  onNodeAction?: (node: NodeItem, actionId: string) => void;
}) {
  const dragRef = useRef<{
    mode: "pan" | "node" | null;
    startX: number;
    startY: number;
    startViewportX: number;
    startViewportY: number;
    startNodeX: number;
    startNodeY: number;
    nodeId: string;
    startScale: number;
  }>({
    mode: null,
    startX: 0,
    startY: 0,
    startViewportX: 0,
    startViewportY: 0,
    startNodeX: 0,
    startNodeY: 0,
    nodeId: "",
    startScale: 1,
  });

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) || null,
    [nodes, selectedId]
  );

  const screenToWorld = useCallback(
    (sx: number, sy: number) => ({
      x: (sx - viewport.x) / viewport.scale,
      y: (sy - viewport.y) / viewport.scale,
    }),
    [viewport]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const world = screenToWorld(mx, my);
      const scaleFactor = Math.exp(-e.deltaY * 0.001);
      const newScale = Math.min(3, Math.max(0.1, viewport.scale * scaleFactor));
      setViewport({
        x: mx - world.x * newScale,
        y: my - world.y * newScale,
        scale: newScale,
      });
    },
    [containerRef, viewport, screenToWorld, setViewport]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    setSelectedId(null);
    dragRef.current = {
      mode: "pan",
      startX: e.clientX,
      startY: e.clientY,
      startViewportX: viewport.x,
      startViewportY: viewport.y,
      startNodeX: 0,
      startNodeY: 0,
      nodeId: "",
      startScale: viewport.scale,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleNodePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    node: NodeItem
  ) => {
    e.stopPropagation();
    setSelectedId(node.id);
    dragRef.current = {
      mode: "node",
      startX: e.clientX,
      startY: e.clientY,
      startViewportX: 0,
      startViewportY: 0,
      startNodeX: node.x,
      startNodeY: node.y,
      nodeId: node.id,
      startScale: viewport.scale,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.mode) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (drag.mode === "pan") {
      setViewport((prev) => ({
        ...prev,
        x: drag.startViewportX + dx,
        y: drag.startViewportY + dy,
      }));
    } else if (drag.mode === "node") {
      const s = drag.startScale;
      setNodes((prev) =>
        prev.map((n) =>
          n.id === drag.nodeId
            ? { ...n, x: drag.startNodeX + dx / s, y: drag.startNodeY + dy / s }
            : n
        )
      );
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current.mode = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleToolbarAction = useCallback(
    (actionId: string) => {
      if (actionId === "delete" && selectedId) {
        setNodes((prev) => prev.filter((n) => n.id === selectedId));
        setSelectedId(null);
        return;
      }
      // 其它动作上抛到顶层（带当前选中节点），由 CanvasPageInner 统一分发
      if (selectedNode && onNodeAction) {
        onNodeAction(selectedNode, actionId);
      }
    },
    [selectedId, setNodes, setSelectedId, selectedNode, onNodeAction]
  );

  return (
    <div
      ref={containerRef}
      className="tc-canvas-surface absolute inset-0 z-0 overflow-hidden bg-black select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
    >
      <div
        className="tc-canvas-world absolute inset-0 origin-top-left"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        }}
      >
        <CanvasBackground />
        {nodes.map((node) =>
          node.type === "text" ? (
            <TextNode
              key={node.id}
              node={node}
              selected={node.id === selectedId}
              onPointerDown={handleNodePointerDown}
            />
          ) : (
            <ImageNode
              key={node.id}
              node={node}
              selected={node.id === selectedId}
              onPointerDown={handleNodePointerDown}
            />
          )
        )}
        {selectedNode && <NodeToolbar node={selectedNode} onAction={handleToolbarAction} />}
      </div>
    </div>
  );
}

const VIDEO_MODELS = [
  { id: "seedance-2", label: "Seedance 2.0" },
  { id: "seedance-mini", label: "Seedance 2.0 Mini" },
  { id: "seedance-fast", label: "Seedance 2.0 Fast" },
];

const VIDEO_ASPECT_RATIOS = [
  { id: "16:9", label: "16:9" },
  { id: "4:3", label: "4:3" },
  { id: "1:1", label: "1:1" },
  { id: "3:4", label: "3:4" },
  { id: "9:16", label: "9:16" },
  { id: "21:9", label: "21:9" },
];

const VIDEO_RESOLUTIONS = [
  { id: "480p", label: "480p" },
  { id: "720p", label: "720p" },
  { id: "1080p", label: "1080p" },
  { id: "2160p", label: "2160p" },
];

const VIDEO_DURATION_MIN = 4;
const VIDEO_DURATION_MAX = 15;
const VIDEO_DURATION_STEP = 1;
const VIDEO_DURATION_TICKS = Array.from(
  { length: (VIDEO_DURATION_MAX - VIDEO_DURATION_MIN) / VIDEO_DURATION_STEP + 1 },
  (_, i) => VIDEO_DURATION_MIN + i * VIDEO_DURATION_STEP,
);

const REF_MODES = [
  { id: "omni", label: "全能参考" },
  { id: "first-last", label: "首尾帧" },
];

const QUANTITIES = ["1x", "2x", "3x", "4x"];

type ImageDockContentProps = {
  editorRef: React.RefObject<HTMLDivElement | null>;
  isEmpty: boolean;
  onInput: () => void;
  onClose: () => void;
  media?: DockMediaItem[];
  onRemoveMedia?: (id: string) => void;
};

function ImageDockContent({ editorRef, isEmpty, onInput, onClose, media = [], onRemoveMedia }: ImageDockContentProps) {
  const settingsRef = useRef<HTMLButtonElement>(null);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState(IMAGE_MODELS[0]);
  const [selectedResolution, setSelectedResolution] = useState(IMAGE_RESOLUTIONS[0]);
  const [selectedAspectRatio, setSelectedAspectRatio] = useState(IMAGE_ASPECT_RATIOS[2]);

  const quantityRef = useRef<HTMLButtonElement>(null);
  const quantityMenuRef = useRef<HTMLDivElement>(null);
  const [quantityOpen, setQuantityOpen] = useState(false);
  const [quantity, setQuantity] = useState("1x");
  const [quantityPos, setQuantityPos] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 });

  useEffect(() => {
    if (quantityOpen && quantityRef.current) {
      const rect = quantityRef.current.getBoundingClientRect();
      setQuantityPos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
    }
  }, [quantityOpen]);

  useEffect(() => {
    if (!quantityOpen) return;
    const handle = (e: MouseEvent) => {
      const t = e.target as Node;
      if (quantityRef.current?.contains(t)) return;
      if (quantityMenuRef.current?.contains(t)) return;
      setQuantityOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [quantityOpen]);

  return (
    <>
      <div
        style={{
          flex: "1 1 0%",
          minHeight: 0,
          padding: "8px 8px 0px",
          display: "flex",
          flexDirection: "column",
          gap: 0,
          justifyContent: "flex-start",
        }}
      >
        <div>
          <div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  borderRadius: 10,
                  position: "relative",
                }}
              >
                <div style={{ position: "absolute", top: 0, right: 0, zIndex: 1 }}>
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={onClose}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      border: 0,
                      background: "transparent",
                      color: "rgba(255, 255, 255, 0.35)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      transition: "background 100ms, color 100ms",
                      fontSize: 13,
                    }}
                  >
                    <X width={13} height={13} />
                  </button>
                </div>

                <div style={{ display: "flex", alignItems: "flex-start", flexWrap: "wrap", gap: 6, paddingLeft: 4 }}>
                  {media.length > 0
                    ? media.map((m) => <DockMediaThumb key={m.id} item={m} onRemove={onRemoveMedia} />)
                    : (
                      <div style={{ position: "relative", flexShrink: 0 }}>
                        <button
                          type="button"
                          aria-label="Upload reference image"
                          style={{
                            position: "relative",
                            width: 44,
                            height: 44,
                            padding: 0,
                            borderRadius: 9,
                            border: "1px solid rgba(255, 255, 255, 0.02)",
                            background: "rgba(255, 255, 255, 0.043)",
                            color: "rgba(255, 255, 255, 0.62)",
                            cursor: "pointer",
                            opacity: 1,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                            transition: "background 120ms, color 120ms",
                            flexShrink: 0,
                          }}
                        >
                          <ImageIcon width={18} height={18} stroke="currentColor" strokeWidth={1.8} aria-hidden="true" />
                        </button>
                      </div>
                    )}
                </div>

                <div style={{ position: "relative", flex: "1 1 0%", minWidth: 0 }}>
                  <div
                    ref={editorRef}
                    contentEditable
                    suppressContentEditableWarning
                    className="tc-panel-textarea-scrollbar"
                    onInput={onInput}
                    style={{
                      width: "100%",
                      minHeight: 56,
                      maxHeight: 452,
                      overflowY: "auto",
                      padding: "6px 8px",
                      margin: 0,
                      borderWidth: "medium",
                      borderStyle: "none",
                      borderColor: "currentcolor",
                      borderImage: "initial",
                      background: "transparent",
                      color: "rgb(255, 255, 255)",
                      fontSize: 14,
                      lineHeight: "22px",
                      outline: "none",
                      wordBreak: "break-word",
                      whiteSpace: "pre-wrap",
                      boxSizing: "border-box",
                      fontFamily: "inherit",
                    }}
                  />
                  {isEmpty && (
                    <div
                      style={{
                        position: "absolute",
                        left: 8,
                        top: 6,
                        color: "rgba(255, 255, 255, 0.3)",
                        fontSize: 14,
                        lineHeight: "22px",
                        pointerEvents: "none",
                      }}
                    >
                      描述你希望如何编辑这张图片...
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          padding: "8px 8px 8px 12px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: "fit-content",
          flexShrink: 0,
          fontSize: 13,
          background: "transparent",
          position: "relative",
        }}
      >
        <div style={{ position: "relative", flexShrink: 0 }}>
          <button
            type="button"
            aria-label="上传图片"
            style={{
              width: 24,
              height: 24,
              padding: 0,
              border: 0,
              borderRadius: "50%",
              background: "rgba(255, 255, 255, 0.07)",
              color: "rgba(255, 255, 255, 0.72)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "background 120ms, color 120ms",
            }}
          >
            <Plus width={14} height={14} />
          </button>
        </div>

        <button
          ref={settingsRef}
          type="button"
          onClick={() => setModelSettingsOpen((v) => !v)}
          aria-label="图像模型设置"
          style={{
            height: 32,
            borderRadius: 8,
            boxSizing: "border-box",
            width: "max-content",
            minWidth: 224,
            maxWidth: 320,
            padding: "0px 8px",
            border: 0,
            background: "var(--tc-dock-control-bg, transparent)",
            color: "rgba(255, 255, 255, 0.85)",
            fontSize: 12,
            lineHeight: "16px",
            fontWeight: 500,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
            transition: "background 100ms",
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              flexShrink: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              gap: 4,
              justifyContent: "flex-start",
              paddingRight: 8,
            }}
          >
            <Settings2 width={14} height={14} stroke="currentColor" strokeWidth={2} aria-hidden="true" />
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", textAlign: "left", fontSize: 12 }}>
              {selectedModel.label}
            </span>
          </div>
          <span
            aria-hidden="true"
            style={{ width: 1, height: 8, flexShrink: 0, alignSelf: "center", background: "rgba(255, 255, 255, 0.08)", borderRadius: 1 }}
          />
          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "0px 8px" }}>{selectedAspectRatio.label}</div>
          <span
            aria-hidden="true"
            style={{ width: 1, height: 8, flexShrink: 0, alignSelf: "center", background: "rgba(255, 255, 255, 0.08)", borderRadius: 1 }}
          />
          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "0px 8px" }}>{selectedResolution.label}</div>
        </button>

        <ImageModelSettingsPopover
          triggerRef={settingsRef}
          open={modelSettingsOpen}
          onClose={() => setModelSettingsOpen(false)}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          selectedResolution={selectedResolution}
          onResolutionChange={setSelectedResolution}
          selectedAspectRatio={selectedAspectRatio}
          onAspectRatioChange={setSelectedAspectRatio}
        />

        <div style={{ flex: "1 1 0%" }} />

        <button
          ref={quantityRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={quantityOpen}
          aria-label="生成数量"
          onClick={() => setQuantityOpen((v) => !v)}
          style={{
            height: 32,
            borderRadius: 8,
            boxSizing: "border-box",
            width: 32,
            minWidth: 32,
            maxWidth: 32,
            padding: 0,
            border: 0,
            background: "var(--tc-dock-control-bg, transparent)",
            color: "rgba(255, 255, 255, 0.85)",
            fontSize: 12,
            lineHeight: "16px",
            fontWeight: 500,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 100ms",
            flexShrink: 0,
            opacity: 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          <span style={{ fontSize: 12, lineHeight: "16px", fontWeight: 600 }}>{quantity}</span>
        </button>

        {quantityOpen &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              ref={quantityMenuRef}
              data-tc-dock-popover=""
              role="listbox"
              aria-label="选择生成数量"
              style={{
                position: "fixed",
                left: quantityPos.left,
                bottom: quantityPos.bottom,
                width: "max-content",
                minWidth: 120,
                padding: "4px 8px",
                borderRadius: 8,
                background: "rgb(30, 30, 30)",
                border: "1px solid rgba(255, 255, 255, 0.04)",
                boxShadow: "rgba(0, 0, 0, 0.25) 0px 4px 16px",
                zIndex: 2147483602,
                display: "flex",
                flexDirection: "column",
                gap: 0,
                boxSizing: "border-box",
                opacity: 1,
                transform: "scale(1) translateY(0px)",
                transformOrigin: "left bottom",
                transition:
                  "opacity 250ms cubic-bezier(0.16, 1, 0.3, 1), transform 250ms cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              {QUANTITIES.map((q) => {
                const selected = quantity === q;
                return (
                  <button
                    key={q}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      setQuantity(q);
                      setQuantityOpen(false);
                    }}
                    style={{
                      width: "100%",
                      padding: "7px 10px",
                      border: 0,
                      borderRadius: 6,
                      background: selected ? "rgba(255, 255, 255, 0.08)" : "transparent",
                      color: selected ? "rgba(255, 255, 255, 0.85)" : "rgba(255, 255, 255, 0.45)",
                      fontSize: 12,
                      lineHeight: "16px",
                      fontWeight: selected ? 500 : 400,
                      cursor: "pointer",
                      textAlign: "left",
                      whiteSpace: "nowrap",
                      transition: "background 80ms",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    {q}
                  </button>
                );
              })}
            </div>,
            document.body,
          )}

        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ position: "relative", display: "inline-flex" }}>
            <button
              type="button"
              disabled
              style={{
                height: 32,
                padding: "0px 12px",
                borderRadius: "8px 0px 0px 8px",
                border: 0,
                fontSize: 12,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                transition: "120ms",
                background: "rgba(255, 255, 255, 0.06)",
                color: "rgba(255, 255, 255, 0.32)",
                cursor: "default",
                opacity: 1,
              }}
            >
              <CreditIcon size={14} />
              <span style={{ fontSize: 12, fontWeight: 600, lineHeight: "16px" }}>0.2</span>
              <span style={{ lineHeight: "16px", marginLeft: 2, display: "inline-flex", alignItems: "center", gap: 4 }}>生成</span>
            </button>
          </div>
          <button
            type="button"
            title="积分模式"
            style={{
              height: 32,
              width: 30,
              padding: 0,
              borderRadius: "0px 8px 8px 0px",
              borderWidth: "medium medium medium 1px",
              borderStyle: "none none none solid",
              borderColor: "currentcolor currentcolor currentcolor rgba(255, 255, 255, 0.08)",
              borderImage: "initial",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "background 100ms, color 100ms",
              background: "rgba(255, 255, 255, 0.06)",
              color: "rgba(255, 255, 255, 0.32)",
              cursor: "default",
            }}
          >
            <ChevronUp width={16} height={16} strokeWidth={2.25} aria-hidden="true" />
          </button>
        </div>
      </div>
    </>
  );
}

function MediaUploadButton({
  label,
  accept,
  icon,
}: {
  label: string;
  accept: string;
  icon: React.ReactNode;
}) {
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <input type="file" accept={accept} multiple aria-hidden="true" style={{ display: "none" }} />
      <button
        type="button"
        aria-label={label}
        style={{
          width: 44,
          height: 44,
          borderRadius: 9,
          border: "1px solid rgba(255, 255, 255, 0.02)",
          background: "rgba(255, 255, 255, 0.043)",
          color: "rgba(255, 255, 255, 0.62)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: 0,
          cursor: "pointer",
          opacity: 1,
          transition: "background 120ms, color 120ms",
          flexShrink: 0,
        }}
      >
        {icon}
      </button>
    </div>
  );
}

function FrameUploadButton({ label }: { label: string }) {
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <input type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" aria-hidden="true" style={{ display: "none" }} />
      <button
        type="button"
        aria-label={label}
        style={{
          width: 48,
          height: 48,
          aspectRatio: "1 / 1",
          padding: 0,
          boxSizing: "border-box",
          borderRadius: 12,
          flexShrink: 0,
          border: "1.5px dashed rgba(255, 255, 255, 0.08)",
          background: "rgba(255, 255, 255, 0.04)",
          color: "rgba(255, 255, 255, 0.3)",
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 2,
          fontSize: 9,
          fontWeight: 500,
          transition: "120ms",
        }}
      >
        <span style={{ opacity: 0.4, flexShrink: 0 }}>
          <IconPlus size={14} />
        </span>
        <span style={{ color: "rgba(255, 255, 255, 0.25)" }}>{label}</span>
      </button>
    </div>
  );
}

// 底部 Dock 里的素材缩略图，带右上角删除按钮
function DockMediaThumb({ item, onRemove }: { item: DockMediaItem; onRemove?: (id: string) => void }) {
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <img
        src={item.src}
        alt={item.name}
        title={item.name}
        draggable={false}
        style={{
          width: 44,
          height: 44,
          borderRadius: 9,
          objectFit: "cover",
          flexShrink: 0,
          display: "block",
          border: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      />
      {onRemove && (
        <button
          type="button"
          aria-label={`移除 ${item.name}`}
          onClick={() => onRemove(item.id)}
          style={{
            position: "absolute",
            top: -6,
            right: -6,
            width: 16,
            height: 16,
            borderRadius: "50%",
            border: 0,
            background: "rgba(0, 0, 0, 0.7)",
            color: "rgba(255, 255, 255, 0.85)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            zIndex: 1,
            backdropFilter: "blur(4px)",
          }}
        >
          <X width={10} height={10} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

type VideoDockContentProps = {
  editorRef: React.RefObject<HTMLDivElement | null>;
  isEmpty: boolean;
  onInput: () => void;
  onClose: () => void;
  refMode: { id: string; label: string };
  setRefMode: (m: { id: string; label: string }) => void;
  refModeOpen: boolean;
  setRefModeOpen: (v: boolean) => void;
  selectedModel: { id: string; label: string };
  setSelectedModel: (m: { id: string; label: string }) => void;
  modelSettingsOpen: boolean;
  setModelSettingsOpen: (v: boolean) => void;
  aspectRatio: { id: string; label: string };
  setAspectRatio: (r: { id: string; label: string }) => void;
  resolution: { id: string; label: string };
  setResolution: (r: { id: string; label: string }) => void;
  duration: number;
  setDuration: (d: number) => void;
  quantity: string;
  setQuantity: (q: string) => void;
  quantityOpen: boolean;
  setQuantityOpen: (v: boolean) => void;
  advancedOpen: boolean;
  setAdvancedOpen: (v: boolean) => void;
  internetSearch: boolean;
  setInternetSearch: (v: boolean) => void;
  media?: DockMediaItem[];
  onRemoveMedia?: (id: string) => void;
};

function VideoDockContent(props: VideoDockContentProps) {
  const {
    editorRef,
    isEmpty,
    onInput,
    onClose,
    refMode,
    setRefMode,
    refModeOpen,
    setRefModeOpen,
    selectedModel,
    setSelectedModel,
    modelSettingsOpen,
    setModelSettingsOpen,
    aspectRatio,
    setAspectRatio,
    resolution,
    setResolution,
    duration,
    setDuration,
    quantity,
    setQuantity,
    quantityOpen,
    setQuantityOpen,
    advancedOpen,
    setAdvancedOpen,
    internetSearch,
    setInternetSearch,
    media = [],
    onRemoveMedia,
  } = props;

  const refModeRef = useRef<HTMLDivElement>(null);
  const refModeMenuRef = useRef<HTMLDivElement>(null);
  const modelSettingsRef = useRef<HTMLButtonElement>(null);
  const modelSettingsMenuRef = useRef<HTMLDivElement>(null);
  const quantityRef = useRef<HTMLDivElement>(null);
  const quantityMenuRef = useRef<HTMLDivElement>(null);

  const [refModePos, setRefModePos] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 });
  const [modelSettingsPos, setModelSettingsPos] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 });
  const [quantityPos, setQuantityPos] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 });
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [resolutionDropdownOpen, setResolutionDropdownOpen] = useState(false);

  useEffect(() => {
    if (refModeOpen && refModeRef.current) {
      const rect = refModeRef.current.getBoundingClientRect();
      setRefModePos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
    }
  }, [refModeOpen]);

  useEffect(() => {
    if (modelSettingsOpen && modelSettingsRef.current) {
      const rect = modelSettingsRef.current.getBoundingClientRect();
      setModelSettingsPos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
    }
  }, [modelSettingsOpen]);

  useEffect(() => {
    if (quantityOpen && quantityRef.current) {
      const rect = quantityRef.current.getBoundingClientRect();
      setQuantityPos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
    }
  }, [quantityOpen]);

  useEffect(() => {
    if (!refModeOpen) return;
    const handle = (e: MouseEvent) => {
      const t = e.target as Node;
      if (refModeRef.current?.contains(t)) return;
      if (refModeMenuRef.current?.contains(t)) return;
      setRefModeOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [refModeOpen, setRefModeOpen]);

  useEffect(() => {
    if (!modelSettingsOpen) return;
    const handle = (e: MouseEvent) => {
      const t = e.target as Node;
      if (modelSettingsRef.current?.contains(t)) return;
      if (modelSettingsMenuRef.current?.contains(t)) return;
      setModelSettingsOpen(false);
      setModelDropdownOpen(false);
      setResolutionDropdownOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [modelSettingsOpen, setModelSettingsOpen]);

  useEffect(() => {
    if (!quantityOpen) return;
    const handle = (e: MouseEvent) => {
      const t = e.target as Node;
      if (quantityRef.current?.contains(t)) return;
      if (quantityMenuRef.current?.contains(t)) return;
      setQuantityOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [quantityOpen, setQuantityOpen]);

  const optionButtonStyle = (selected: boolean) => ({
    display: "flex" as const,
    alignItems: "center" as const,
    width: "100%" as const,
    textAlign: "left" as const,
    padding: "6px 8px",
    borderRadius: 6,
    border: 0,
    background: selected ? "rgba(255, 255, 255, 0.08)" : "transparent",
    color: selected ? "rgba(255, 255, 255, 0.95)" : "rgba(255, 255, 255, 0.75)",
    fontSize: 12,
    cursor: "pointer" as const,
    transition: "background 100ms",
  });

  return (
    <>
      <div
        style={{
          flex: "1 1 0%",
          minHeight: 0,
          padding: "8px 8px 0px",
          display: "flex",
          flexDirection: "column",
          gap: 0,
          justifyContent: "flex-start",
        }}
      >
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 0, width: "100%" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                borderRadius: 10,
                position: "relative",
              }}
            >
              <div style={{ position: "absolute", top: 0, right: 0, zIndex: 1 }}>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={onClose}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    border: 0,
                    background: "transparent",
                    color: "rgba(255, 255, 255, 0.35)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    transition: "background 100ms, color 100ms",
                    fontSize: 13,
                  }}
                >
                  <IconClose size={13} />
                </button>
              </div>

              {refMode.id === "first-last" ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    padding: "0px 32px 0px 4px",
                    width: "100%",
                    boxSizing: "border-box",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 0%", minWidth: 0 }}>
                    <FrameUploadButton label="首帧" />
                    <button
                      type="button"
                      aria-label="交换首尾帧"
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: "50%",
                        border: 0,
                        outline: "none",
                        background: "rgba(255, 255, 255, 0.08)",
                        color: "rgba(255, 255, 255, 0.7)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        transition: "background 120ms, color 120ms",
                      }}
                    >
                      <ArrowLeftRight width={13} height={13} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <FrameUploadButton label="尾帧" />
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    paddingLeft: 4,
                    paddingRight: 32,
                    minHeight: 44,
                    width: "100%",
                    boxSizing: "border-box",
                    flexWrap: "wrap",
                  }}
                >
                  {media.length > 0
                    ? media.map((m) => <DockMediaThumb key={m.id} item={m} onRemove={onRemoveMedia} />)
                    : (
                      <MediaUploadButton
                        label="参考图片"
                        accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                        icon={<ImageIcon width={15} height={15} stroke="currentColor" strokeWidth={2} aria-hidden="true" />}
                      />
                    )}
                  <span style={{ color: "rgba(255, 255, 255, 0.22)", fontSize: 14, lineHeight: 1 }}>·</span>
                  <MediaUploadButton
                    label="视频"
                    accept=".mp4,video/mp4"
                    icon={<Video width={15} height={15} stroke="currentColor" strokeWidth={2} aria-hidden="true" />}
                  />
                  <span style={{ color: "rgba(255, 255, 255, 0.22)", fontSize: 14, lineHeight: 1 }}>·</span>
                  <MediaUploadButton
                    label="音频"
                    accept=".mp3,.wav,.m4a,audio/mpeg,audio/mp3,audio/wav,audio/wave,audio/x-wav,audio/mp4,audio/x-m4a"
                    icon={<AudioLines width={15} height={15} stroke="currentColor" strokeWidth={1.8} aria-hidden="true" />}
                  />
                </div>
              )}

              <div style={{ position: "relative", flex: "1 1 0%", minWidth: 0 }}>
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  className="tc-panel-textarea-scrollbar"
                  onInput={onInput}
                  style={{
                    width: "100%",
                    minHeight: 56,
                    maxHeight: 452,
                    overflowY: "auto",
                    padding: "6px 36px 6px 4px",
                    margin: 0,
                    borderWidth: "medium",
                    borderStyle: "none",
                    borderColor: "currentcolor",
                    borderImage: "initial",
                    background: "transparent",
                    color: "rgb(255, 255, 255)",
                    fontSize: 14,
                    lineHeight: "22px",
                    outline: "none",
                    wordBreak: "break-word",
                    whiteSpace: "pre-wrap",
                    boxSizing: "border-box",
                    fontFamily: "inherit",
                  }}
                />
                {isEmpty && (
                  <div
                    style={{
                      position: "absolute",
                      left: 4,
                      top: 6,
                      color: "rgba(255, 255, 255, 0.3)",
                      fontSize: 14,
                      lineHeight: "22px",
                      pointerEvents: "none",
                      right: 36,
                    }}
                  >
                    {refMode.id === "first-last"
                      ? "请描述你想生成的视频内容。"
                      : "上传 3-10 秒视频片段，并结合文本或图片轻松修改内容、改变镜头角度或重塑原视频风格。可使用 @ 快速插入已添加资源。"}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          padding: "8px 8px 8px 12px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: "fit-content",
          flexShrink: 0,
          fontSize: 13,
          background: "transparent",
          position: "relative",
        }}
      >
        <div style={{ position: "relative", flexShrink: 0 }}>
          <button
            type="button"
            aria-label="上传"
            style={{
              width: 24,
              height: 24,
              padding: 0,
              border: 0,
              borderRadius: "50%",
              background: "rgba(255, 255, 255, 0.07)",
              color: "rgba(255, 255, 255, 0.72)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "background 120ms, color 120ms",
            }}
          >
            <IconPlus size={14} />
          </button>
        </div>

        <div ref={refModeRef} style={{ position: "relative", flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setRefModeOpen(!refModeOpen)}
            style={{
              height: 32,
              borderRadius: 8,
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "0px 8px",
              border: 0,
              background: "var(--tc-dock-control-bg, transparent)",
              color: "rgb(255, 255, 255)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              transition: "background 200ms cubic-bezier(0.16, 1, 0.3, 1)",
              whiteSpace: "nowrap",
            }}
          >
            {refMode.label}
            <ChevronDown
              width={12}
              height={12}
              strokeWidth={2}
              aria-hidden="true"
              style={{
                opacity: 0.7,
                transform: refModeOpen ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 150ms",
              }}
            />
          </button>
        </div>

        <button
          ref={modelSettingsRef}
          type="button"
          onClick={() => setModelSettingsOpen(!modelSettingsOpen)}
          style={{
            height: 32,
            borderRadius: 8,
            boxSizing: "border-box",
            width: "max-content",
            minWidth: 224,
            maxWidth: 320,
            padding: "0px 8px",
            border: 0,
            background: "var(--tc-dock-control-bg, transparent)",
            color: "rgba(255, 255, 255, 0.85)",
            fontSize: 12,
            lineHeight: "16px",
            fontWeight: 500,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
            transition: "background 100ms",
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              flexShrink: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              gap: 4,
              justifyContent: "flex-start",
              paddingRight: 8,
            }}
          >
            <Settings2
              width={14}
              height={14}
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
              style={{ flexShrink: 0 }}
            />
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                textAlign: "left",
                fontSize: 12,
              }}
            >
              {selectedModel.label}
            </span>
          </div>
          <span
            aria-hidden="true"
            style={{
              width: 1,
              height: 8,
              flexShrink: 0,
              alignSelf: "center",
              background: "rgba(255, 255, 255, 0.08)",
              borderRadius: 1,
            }}
          />
          <div
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0px 8px",
            }}
          >
            {aspectRatio.label}
          </div>
          <span
            aria-hidden="true"
            style={{
              width: 1,
              height: 8,
              flexShrink: 0,
              alignSelf: "center",
              background: "rgba(255, 255, 255, 0.08)",
              borderRadius: 1,
            }}
          />
          <div
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0px 8px",
            }}
          >
            {resolution.label}
          </div>
          <span
            aria-hidden="true"
            style={{
              width: 1,
              height: 8,
              flexShrink: 0,
              alignSelf: "center",
              background: "rgba(255, 255, 255, 0.08)",
              borderRadius: 1,
            }}
          />
          <div
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0px 8px",
            }}
          >
            {duration}s
          </div>
        </button>

        <button
          type="button"
          title="高级设置"
          onClick={() => setAdvancedOpen(!advancedOpen)}
          style={{
            height: 32,
            width: 32,
            borderRadius: 6,
            border: 0,
            background: "var(--tc-dock-control-bg, transparent)",
            color: "rgba(255, 255, 255, 0.4)",
            cursor: "pointer",
            display: "none",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 100ms, color 100ms",
            flexShrink: 0,
          }}
        >
          <Settings width={14} height={14} stroke="currentColor" strokeWidth={2} aria-hidden="true" />
        </button>

        <div style={{ flex: "1 1 0%" }} />

        <div ref={quantityRef} style={{ position: "relative", flexShrink: 0 }}>
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={quantityOpen}
            aria-label="生成数量"
            onClick={() => setQuantityOpen(!quantityOpen)}
            style={{
              height: 32,
              borderRadius: 8,
              boxSizing: "border-box",
              width: 32,
              minWidth: 32,
              maxWidth: 32,
              padding: 0,
              border: 0,
              background: "var(--tc-dock-control-bg, transparent)",
              color: "rgba(255, 255, 255, 0.85)",
              fontSize: 12,
              lineHeight: "16px",
              fontWeight: 500,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 100ms",
              flexShrink: 0,
              opacity: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
          >
            <span style={{ fontSize: 12, lineHeight: "16px", fontWeight: 600 }}>{quantity}</span>
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ position: "relative", display: "inline-flex" }}>
            <button
              type="button"
              disabled
              style={{
                height: 32,
                padding: "0px 12px",
                borderRadius: "8px 0px 0px 8px",
                border: 0,
                fontSize: 12,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                transition: "120ms",
                background: "rgba(255, 255, 255, 0.06)",
                color: "rgba(255, 255, 255, 0.32)",
                cursor: "default",
                opacity: 1,
              }}
            >
              <CreditIcon size={14} />
              <span style={{ fontSize: 12, fontWeight: 600, lineHeight: "16px" }}>15</span>
              <span style={{ lineHeight: "16px", marginLeft: 2, display: "inline-flex", alignItems: "center", gap: 4 }}>
                生成
              </span>
            </button>
          </div>
          <button
            type="button"
            title="积分模式"
            style={{
              height: 32,
              width: 30,
              padding: 0,
              borderRadius: "0px 8px 8px 0px",
              borderWidth: "medium medium medium 1px",
              borderStyle: "none none none solid",
              borderColor: "currentcolor currentcolor currentcolor rgba(255, 255, 255, 0.08)",
              borderImage: "initial",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "background 100ms, color 100ms",
              background: "rgba(255, 255, 255, 0.06)",
              color: "rgba(255, 255, 255, 0.32)",
              cursor: "default",
            }}
          >
            <ChevronUp width={16} height={16} strokeWidth={2.25} aria-hidden="true" />
          </button>
        </div>
      </div>

      {refModeOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={refModeMenuRef}
            data-tc-tab-dropdown-menu="true"
            style={{
              position: "fixed",
              left: refModePos.left,
              bottom: refModePos.bottom,
              minWidth: 168,
              height: "fit-content",
              background: "rgba(41, 41, 41, 0.92)",
              backdropFilter: "blur(40px)",
              border: "1px solid rgba(255, 255, 255, 0.04)",
              borderRadius: 8,
              padding: "8px 4px",
              zIndex: 2147483602,
              boxShadow: "rgba(0, 0, 0, 0.6) 0px 8px 24px",
              opacity: 1,
              transform: "scale(1) translateY(0px)",
              transformOrigin: "left bottom",
              transition:
                "opacity 250ms cubic-bezier(0.16, 1, 0.3, 1), transform 250ms cubic-bezier(0.16, 1, 0.3, 1)",
              display: "flex",
              flexDirection: "column",
              gap: 0,
            }}
          >
            {REF_MODES.map((m) => {
              const selected = refMode.id === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setRefMode(m);
                    setRefModeOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "8px 16px",
                    border: 0,
                    borderRadius: 4,
                    background: selected ? "rgba(255, 255, 255, 0.08)" : "transparent",
                    color: selected ? "rgb(255, 255, 255)" : "rgba(255, 255, 255, 0.7)",
                    fontSize: 12,
                    fontWeight: selected ? 600 : 500,
                    cursor: "pointer",
                    textAlign: "left",
                    transition: selected
                      ? "background 180ms cubic-bezier(0.16, 1, 0.3, 1)"
                      : "background 100ms ease-in",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )}

      {modelSettingsOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={modelSettingsMenuRef}
            data-tc-dock-popover=""
            style={{
              position: "fixed",
              left: modelSettingsPos.left,
              bottom: modelSettingsPos.bottom,
              width: "max-content",
              minWidth: 320,
              padding: "4px 8px",
              borderRadius: 8,
              background: "rgb(30, 30, 30)",
              border: "1px solid rgba(255, 255, 255, 0.04)",
              boxShadow: "rgba(0, 0, 0, 0.25) 0px 4px 16px",
              zIndex: 2147483602,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              opacity: 1,
              transform: "scale(1) translateY(0px)",
              transformOrigin: "left bottom",
              transition:
                "opacity 250ms cubic-bezier(0.16, 1, 0.3, 1), transform 250ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {/* 模型与质量 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 0" }}>
              <div style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.45)", fontWeight: 500, padding: "0px 4px" }}>
                模型与质量
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                {/* 模型下拉 */}
                <div style={{ width: 224, flexShrink: 0, position: "relative" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setModelDropdownOpen((v) => !v);
                      setResolutionDropdownOpen(false);
                    }}
                    style={{
                      height: 36,
                      padding: "0px 8px",
                      borderRadius: 8,
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      background: "rgba(255, 255, 255, 0.04)",
                      color: "rgb(255, 255, 255)",
                      fontSize: 12,
                      lineHeight: "16px",
                      fontWeight: 400,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      transition: "background 100ms",
                      whiteSpace: "nowrap",
                      maxWidth: "none",
                      width: 224,
                      justifyContent: "space-between",
                      boxSizing: "border-box",
                    }}
                  >
                    <span
                      style={{
                        color: "rgb(255, 255, 255)",
                        fontSize: 12,
                        lineHeight: "16px",
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {selectedModel.label}
                    </span>
                    <ChevronDown width={14} height={14} style={{ opacity: 0.6, marginLeft: "auto" }} />
                  </button>
                  {modelDropdownOpen && (
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 6px)",
                        left: 0,
                        zIndex: 10,
                        background: "rgb(30, 30, 30)",
                        border: "1px solid rgba(255, 255, 255, 0.04)",
                        borderRadius: 8,
                        padding: 4,
                        boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
                        minWidth: 224,
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      {VIDEO_MODELS.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setSelectedModel(m);
                            setModelDropdownOpen(false);
                          }}
                          style={{
                            height: 32,
                            padding: "0px 8px",
                            borderRadius: 6,
                            border: 0,
                            background:
                              selectedModel.id === m.id ? "rgba(255, 255, 255, 0.08)" : "transparent",
                            color: "rgb(255, 255, 255)",
                            fontSize: 12,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            transition: "background 100ms",
                            whiteSpace: "nowrap",
                            textAlign: "left",
                          }}
                        >
                          <span style={{ fontWeight: 600 }}>{m.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 分辨率下拉 */}
                <div
                  style={{
                    flex: "1 1 0%",
                    minWidth: 224,
                    position: "relative",
                    display: "block",
                    width: "100%",
                    boxSizing: "border-box",
                    verticalAlign: "middle",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setResolutionDropdownOpen((v) => !v);
                      setModelDropdownOpen(false);
                    }}
                    style={{
                      height: 36,
                      padding: "0px 8px",
                      borderRadius: 8,
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      background: "rgba(255, 255, 255, 0.04)",
                      color: "rgb(255, 255, 255)",
                      fontSize: 12,
                      lineHeight: "16px",
                      fontWeight: 400,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      transition: "background 100ms",
                      whiteSpace: "nowrap",
                      width: "100%",
                      boxSizing: "border-box",
                      justifyContent: "space-between",
                    }}
                  >
                    <span
                      style={{
                        color: "rgb(255, 255, 255)",
                        fontSize: 12,
                        lineHeight: "16px",
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: "1 1 0%",
                        textAlign: "left",
                      }}
                    >
                      {resolution.label}
                    </span>
                    <ChevronDown width={14} height={14} style={{ opacity: 0.6, marginLeft: "auto" }} />
                  </button>
                  {resolutionDropdownOpen && (
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 6px)",
                        left: 0,
                        zIndex: 10,
                        background: "rgb(30, 30, 30)",
                        border: "1px solid rgba(255, 255, 255, 0.04)",
                        borderRadius: 8,
                        padding: 4,
                        boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
                        minWidth: 224,
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      {VIDEO_RESOLUTIONS.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => {
                            setResolution(r);
                            setResolutionDropdownOpen(false);
                          }}
                          style={{
                            height: 32,
                            padding: "0px 8px",
                            borderRadius: 6,
                            border: 0,
                            background:
                              resolution.id === r.id ? "rgba(255, 255, 255, 0.08)" : "transparent",
                            color: "rgb(255, 255, 255)",
                            fontSize: 12,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            transition: "background 100ms",
                            whiteSpace: "nowrap",
                            width: "100%",
                            boxSizing: "border-box",
                          }}
                        >
                          <span style={{ fontWeight: 600 }}>{r.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 时长滑块 */}
            <div className="tc-duration-slider">
              <div className="tc-duration-slider__header">
                <span className="tc-duration-slider__label">时长</span>
                <span className="tc-duration-slider__value">{duration}s</span>
              </div>
              <input
                className="tc-duration-slider__input"
                min={VIDEO_DURATION_MIN}
                max={VIDEO_DURATION_MAX}
                step={VIDEO_DURATION_STEP}
                aria-label="时长"
                aria-valuetext={`${duration}s`}
                type="range"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                style={{
                  ["--tc-duration-slider-progress" as string]: `${
                    ((duration - VIDEO_DURATION_MIN) / (VIDEO_DURATION_MAX - VIDEO_DURATION_MIN)) * 100
                  }%`,
                }}
              />
              <div className="tc-duration-slider__ticks" aria-hidden="true">
                <div className="tc-duration-slider__tick-track">
                  {VIDEO_DURATION_TICKS.map((t) => (
                    <span
                      key={t}
                      className={`tc-duration-slider__tick${t === duration ? " tc-duration-slider__tick--active" : ""}`}
                      style={{
                        ["--tc-duration-slider-tick-position" as string]: `${
                          ((t - VIDEO_DURATION_MIN) / (VIDEO_DURATION_MAX - VIDEO_DURATION_MIN)) * 100
                        }%`,
                      }}
                    />
                  ))}
                </div>
              </div>
              <div className="tc-duration-slider__limits" aria-hidden="true">
                <span>{VIDEO_DURATION_MIN}s</span>
                <span>{VIDEO_DURATION_MAX}s</span>
              </div>
            </div>

            {/* 宽高比 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}>
              <div style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.45)", fontWeight: 500, padding: "0px 4px" }}>
                宽高比
              </div>
              <div
                style={{
                  display: "flex",
                  background: "rgba(255, 255, 255, 0.04)",
                  borderRadius: 8,
                  padding: 4,
                  gap: 2,
                }}
              >
                {VIDEO_ASPECT_RATIOS.map((r) => {
                  const selected = aspectRatio.id === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setAspectRatio(r)}
                      style={{
                        flex: "1 1 0%",
                        height: 44,
                        border: 0,
                        borderRadius: 6,
                        background: selected ? "rgba(255, 255, 255, 0.08)" : "transparent",
                        color: selected ? "rgb(255, 255, 255)" : "rgba(255, 255, 255, 0.45)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                        cursor: "pointer",
                        transition: "150ms",
                        padding: 0,
                      }}
                    >
                      <span style={{ opacity: selected ? 1 : 0.6, flexShrink: 0 }}>
                        <AspectRatioIcon ratio={r.id} width={14} height={14} filled={false} />
                      </span>
                      <span style={{ fontSize: 11, fontWeight: selected ? 600 : 500, lineHeight: "12px" }}>
                        {r.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {quantityOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={quantityMenuRef}
            data-tc-dock-popover=""
            role="listbox"
            aria-label="选择生成数量"
            style={{
              position: "fixed",
              left: quantityPos.left,
              bottom: quantityPos.bottom,
              width: "max-content",
              minWidth: 120,
              padding: "4px 8px",
              borderRadius: 8,
              background: "rgb(30, 30, 30)",
              border: "1px solid rgba(255, 255, 255, 0.04)",
              boxShadow: "rgba(0, 0, 0, 0.25) 0px 4px 16px",
              zIndex: 2147483602,
              display: "flex",
              flexDirection: "column",
              gap: 0,
              boxSizing: "border-box",
              opacity: 1,
              transform: "scale(1) translateY(0px)",
              transformOrigin: "left bottom",
              transition:
                "opacity 250ms cubic-bezier(0.16, 1, 0.3, 1), transform 250ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {QUANTITIES.map((q) => {
              const selected = quantity === q;
              return (
                <button
                  key={q}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    setQuantity(q);
                    setQuantityOpen(false);
                  }}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    border: 0,
                    borderRadius: 6,
                    background: selected ? "rgba(255, 255, 255, 0.08)" : "transparent",
                    color: selected ? "rgba(255, 255, 255, 0.85)" : "rgba(255, 255, 255, 0.45)",
                    fontSize: 12,
                    lineHeight: "16px",
                    fontWeight: selected ? 500 : 400,
                    cursor: "pointer",
                    textAlign: "left",
                    whiteSpace: "nowrap",
                    transition: "background 80ms",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {q}
                </button>
              );
            })}
          </div>,
          document.body,
        )}

      <div
        style={{
          display: "grid",
          gridTemplateRows: advancedOpen ? "1fr" : "0fr",
          opacity: advancedOpen ? 1 : 0,
          overflow: "hidden",
          transition: "grid-template-rows 160ms ease-in, opacity 140ms ease-in",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          <div
            style={{
              borderTop: "1px solid rgba(255, 255, 255, 0.07)",
              background: "rgb(29, 29, 29)",
              borderRadius: "0px 0px 12px 12px",
              padding: "4px 12px 8px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "7px 0px",
                gap: 12,
              }}
            >
              <span style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.65)", fontWeight: 400 }}>联网搜索</span>
              <button
                type="button"
                onClick={() => setInternetSearch(!internetSearch)}
                style={{
                  position: "relative",
                  width: 36,
                  height: 20,
                  borderRadius: 10,
                  border: 0,
                  background: internetSearch ? "rgba(255, 255, 255, 0.5)" : "rgba(255, 255, 255, 0.15)",
                  cursor: "pointer",
                  transition: "background 150ms",
                  flexShrink: 0,
                  padding: 0,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 2,
                    left: internetSearch ? 18 : 2,
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: "rgb(255, 255, 255)",
                    transition: "left 150ms, background 150ms",
                    boxShadow: "rgba(0, 0, 0, 0.3) 0px 1px 3px",
                  }}
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function BottomDock({
  mode,
  onClose,
  imageMedia = [],
  videoMedia = [],
  onRemoveImageMedia,
  onRemoveVideoMedia,
}: {
  mode: "image" | "video";
  onClose: () => void;
  imageMedia?: DockMediaItem[];
  videoMedia?: DockMediaItem[];
  onRemoveImageMedia?: (id: string) => void;
  onRemoveVideoMedia?: (id: string) => void;
}) {
  const [input, setInput] = useState("");
  const [dockSize, setDockSize] = useState({ w: 680, h: 164 });
  const editorRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [refMode, setRefMode] = useState(REF_MODES[0]);
  const [refModeOpen, setRefModeOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState(VIDEO_MODELS[0]);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(VIDEO_ASPECT_RATIOS[0]);
  const [resolution, setResolution] = useState(VIDEO_RESOLUTIONS[1]);
  const [duration, setDuration] = useState(10);
  const [quantity, setQuantity] = useState("1x");
  const [quantityOpen, setQuantityOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [internetSearch, setInternetSearch] = useState(false);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect;
      setDockSize({ w: 680, h: Math.round(cr.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const path = squirclePath(dockSize.w, dockSize.h, 28.8);
  const isEmpty = input.trim().length === 0;

  const handleInput = () => {
    const text = editorRef.current?.innerText ?? "";
    setInput(text);
  };

  return (
    <div
      data-canvas-reference-drop-target={mode === "image" ? "image-dock" : "video-dock"}
      style={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 2147483601,
        width: 680,
      }}
    >
      <div
        style={{
          clipPath: "inset(0%)",
          opacity: 1,
          transition: "clip-path 120ms cubic-bezier(0.16, 1, 0.3, 1), opacity 120ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div style={{ position: "relative" }}>
          <SmoothCorners
            width={dockSize.w}
            height={dockSize.h}
            path={path}
            overlay={false}
            stroke={{ color: "#ffffff", width: 2, opacity: 0.04 }}
            style={{
              background: "rgba(41, 41, 41, 0.92)",
              backdropFilter: "blur(40px)",
              border: 0,
              display: "flex",
              flexDirection: "column",
              fontFamily: "Inter, -apple-system, sans-serif",
            }}
          >
            <div
              ref={contentRef}
              className="nodrag nopan nowheel"
              style={{ width: 680, background: "transparent", display: "flex", flexDirection: "column" }}
            >
              {mode === "image" ? (
                <ImageDockContent editorRef={editorRef} isEmpty={isEmpty} onInput={handleInput} onClose={onClose} media={imageMedia} onRemoveMedia={onRemoveImageMedia} />
              ) : (
                <VideoDockContent
                  editorRef={editorRef}
                  isEmpty={isEmpty}
                  onInput={handleInput}
                  onClose={onClose}
                  refMode={refMode}
                  setRefMode={setRefMode}
                  refModeOpen={refModeOpen}
                  setRefModeOpen={setRefModeOpen}
                  selectedModel={selectedModel}
                  setSelectedModel={setSelectedModel}
                  modelSettingsOpen={modelSettingsOpen}
                  setModelSettingsOpen={setModelSettingsOpen}
                  aspectRatio={aspectRatio}
                  setAspectRatio={setAspectRatio}
                  resolution={resolution}
                  setResolution={setResolution}
                  duration={duration}
                  setDuration={setDuration}
                  quantity={quantity}
                  setQuantity={setQuantity}
                  quantityOpen={quantityOpen}
                  setQuantityOpen={setQuantityOpen}
                  advancedOpen={advancedOpen}
                  setAdvancedOpen={setAdvancedOpen}
                  internetSearch={internetSearch}
                  setInternetSearch={setInternetSearch}
                  media={videoMedia}
                  onRemoveMedia={onRemoveVideoMedia}
                />
              )}
            </div>
          </SmoothCorners>
        </div>
      </div>
    </div>
  );
}


function ComposerShell({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 460, h: 120 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect;
      setSize({ w: Math.round(cr.width), h: Math.round(cr.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setSize({ w: Math.round(rect.width), h: Math.round(rect.height) });
  }, []);

  const path = squirclePath(size.w, size.h, 25.2);

  return (
    <div ref={ref} className="relative" style={{ maxHeight: 200 }}>
      <SmoothCorners
        width={size.w}
        height={size.h}
        path={path}
        overlay={false}
        stroke={{ color: "#ffffff", width: 2, opacity: 0.1 }}
        className="tc-agent-composer-drop-target absolute inset-0"
        dataAttributes={{
          "canvas-reference-drop-target": "agent-chat",
          "tour-target": "agent-composer-input",
        }}
        style={{
          position: "absolute",
          inset: 0,
          display: "block",
          background: "rgba(0, 0, 0, 0.45)",
        }}
      >
        {null}
      </SmoothCorners>
      <div className="relative overflow-hidden rounded-[25.2px]">{children}</div>
    </div>
  );
}

function ModelSettingsMenu({
  mode,
  model,
  modes,
  models,
  onModeChange,
  onModelChange,
  onClose,
  menuRef,
  triggerRef,
}: {
  mode: { id: string; label: string; description: string };
  model: { id: string; label: string; costMultiplier: string };
  modes: { id: string; label: string; description: string }[];
  models: { id: string; label: string; costMultiplier: string }[];
  onModeChange: (mode: { id: string; label: string; description: string }) => void;
  onModelChange: (model: { id: string; label: string; costMultiplier: string }) => void;
  onClose: () => void;
  menuRef: React.RefObject<HTMLDivElement | null>;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;

    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const padding = 8;
    const left = Math.max(8, triggerRect.right - menuRect.width);
    const top = triggerRect.top - menuRect.height - padding;
    setPosition({ left, top });
    setIsVisible(true);
  }, [menuRef, triggerRef]);

  return (
    <div
      ref={menuRef}
      className="tc-model-settings-menu"
      role="dialog"
      aria-label="模式与模型"
      style={{
        position: "fixed",
        boxSizing: "border-box",
        padding: 6,
        borderRadius: 12,
        border: "1px solid rgba(255, 255, 255, 0.1)",
        background: "rgba(32, 32, 32, 0.96)",
        boxShadow: "0 14px 40px rgba(0, 0, 0, 0.32)",
        backdropFilter: "blur(24px)",
        overflowY: "auto",
        overscrollBehavior: "contain",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        zIndex: 2147483605,
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        width: 284,
        visibility: isVisible ? "visible" : "hidden",
      }}
    >
      <section className="tc-model-settings-section" aria-label="创作模式">
        <div className="tc-model-settings-section__title px-2 py-1.5 text-[11px] font-medium text-white/45">
          创作模式
        </div>
        {modes.map((m) => {
          const selected = m.id === mode.id;
          return (
            <button
              key={m.id}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => {
                onModeChange(m);
                onClose();
              }}
              className={`tc-creation-mode-option flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left transition-colors ${
                selected
                  ? "tc-creation-mode-option--selected bg-white/[0.08]"
                  : "hover:bg-white/[0.05]"
              }`}
            >
              <span className="tc-creation-mode-option__content flex min-w-0 flex-col">
                <span className="tc-creation-mode-option__label text-[13px] font-medium text-white/90">
                  {m.label}
                </span>
                <span className="tc-creation-mode-option__description text-[11px] leading-4 text-white/45">
                  {m.description}
                </span>
              </span>
              {selected && (
                <Check
                  size={14}
                  className="tc-creation-mode-option__check shrink-0 text-white/80"
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </section>

      <div className="tc-model-settings-divider mx-1 my-1 h-px bg-white/[0.08]" aria-hidden="true" />

      <section className="tc-model-settings-section" aria-label="Agent 模型">
        <div className="tc-model-settings-section__title px-2 py-1.5 text-[11px] font-medium text-white/45">
          Agent 模型
        </div>
        <div className="tc-model-tier-menu__intro px-2 pb-1.5 text-[11px] leading-4 text-white/40">
          选择驱动 Agent 的模型。
        </div>
        {models.map((m) => {
          const selected = m.id === model.id;
          return (
            <button
              key={m.id}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => {
                onModelChange(m);
                onClose();
              }}
              className={`tc-model-tier-option w-full rounded-lg px-2 py-2 text-left transition-colors ${
                selected
                  ? "tc-model-tier-option--selected bg-white/[0.08]"
                  : "hover:bg-white/[0.05]"
              }`}
            >
              <span className="tc-model-tier-option__header flex w-full items-center justify-between gap-2">
                <span className="tc-model-tier-option__label text-[13px] font-medium text-white/90">
                  {m.label}
                </span>
                <span
                  className="tc-model-tier-option__cost inline-flex items-center gap-1 text-[11px] text-white/45"
                  aria-label={`消耗 ${m.costMultiplier}`}
                >
                  <span className="tc-model-tier-option__cost-icon" aria-hidden="true">
                    💰
                  </span>
                  <span className="tc-model-tier-option__cost-label">消耗</span>
                  <span className="tc-model-tier-option__cost-rate">{m.costMultiplier}</span>
                </span>
              </span>
            </button>
          );
        })}
      </section>
    </div>
  );
}

function AgentChatPanel({
  prompt,
  isOpen,
  onClose,
  pendingMention,
  onMentionConsumed,
}: {
  prompt: string;
  isOpen: boolean;
  onClose: () => void;
  pendingMention?: { name: string; nonce: number } | null;
  onMentionConsumed?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 1, type: "user", text: prompt || "生成一个小猫" },
    {
      id: 2,
      type: "thinking",
      text: "思考过程",
      content: "The user wants to generate an image of a kitten. This is a simple, direct image generation request in Instant mode. Let me follow the workflow:\n\n1. This is a direct final prompt for image generation - \"生成一个小猫\" (generate a kitten)\n2. I need to load the direct workflow and output-card-image skill\n3. For image requests, I create ImageCard task cards directly without preview/confirmation\n\nLet me first set the display language (user is writing in Chinese), then view the necessary skills, and create the image card directly.\n\nThe user's language is zh-CN based on \"生成一个小猫\".\n\nLet me view the workflow and output skill, then create the image card.\nThe user wants to generate an image of a kitten (\"生成一个小猫\"). This is a direct image generation request in Instant mode. According to the workflow, ImageCards skip preview and approval - I should create the card directly.\n\nLet me call plan_output_kinds and then image_card_output_fn directly.",
    },
    { id: 3, type: "agent", text: "正在为你生成一张可爱的小猫图片 🐱\n\n\n\n" },
    {
      id: 4,
      type: "card",
      text: "一只毛茸茸的小猫咪，大大的圆眼睛，柔软的毛发，表情呆萌可爱，自然光线柔和，浅景深特写，温暖治愈的氛围，高清细节",
      meta: "1:1",
      collapsed: false,
      status: "failed",
    },
    { id: 5, type: "agent", text: "图片生成任务已发送至画布，生成过程会自动开始，请在画布上查看最终效果。" },
    { id: 6, type: "agent", text: "正在为你生成一张可爱的小猫图片 🐱\n\n\n\n图片生成任务已发送至画布，生成过程会自动开始，请在画布上查看最终效果。" },
  ]);

  const [composerEmpty, setComposerEmpty] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [panelSize, setPanelSize] = useState({ w: 468, h: 600 });
  const [skillPanelOpen, setSkillPanelOpen] = useState(false);

  const CREATION_MODES = useMemo(
    () => [
      { id: "agent", label: "Agent", description: "对话拆解，逐步完善。" },
      { id: "direct", label: "Direct Gen", description: "根据提示词直接生成图片或视频卡片。" },
    ],
    []
  );

  const AGENT_MODELS = useMemo(
    () => [
      { id: "claude-opus-4-7", label: "Claude Opus 4.7", costMultiplier: "5x" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", costMultiplier: "3x" },
      { id: "gemini-3-5-flash", label: "Gemini 3.5 Flash", costMultiplier: "2x" },
      { id: "qwen-3-7-max", label: "Qwen 3.7 Max", costMultiplier: "1.3x" },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", costMultiplier: "1x" },
      { id: "gemini-3-1-flash-lite", label: "Gemini 3.1 Flash Lite", costMultiplier: "0.3x" },
    ],
    []
  );

  const [selectedMode, setSelectedMode] = useState(CREATION_MODES[0]);
  const [selectedModel, setSelectedModel] = useState(AGENT_MODELS[3]);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const modelSettingsTriggerRef = useRef<HTMLButtonElement>(null);
  const modelSettingsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect;
      if (cr.width === 0 || cr.height === 0) return;
      setPanelSize({ w: Math.round(cr.width), h: Math.round(cr.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollButton(gap > 48);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [messages]);

  useEffect(() => {
    if (!modelSettingsOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const menu = modelSettingsMenuRef.current;
      const trigger = modelSettingsTriggerRef.current;
      if (
        menu &&
        !menu.contains(event.target as Node) &&
        trigger &&
        !trigger.contains(event.target as Node)
      ) {
        setModelSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [modelSettingsOpen]);

  const handleComposerInput = () => {
    const text = composerRef.current?.innerText ?? "";
    setComposerEmpty(text.trim().length === 0);
  };

  const insertSkillIntoComposer = useCallback((skillName: string) => {
    const editor = composerRef.current;
    if (!editor) return;

    editor.focus();
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        const textNode = document.createTextNode(`@${skillName} `);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        editor.appendChild(document.createTextNode(`@${skillName} `));
      }
    } else {
      editor.appendChild(document.createTextNode(`@${skillName} `));
    }

    handleComposerInput();
    setSkillPanelOpen(false);
  }, []);

  // 外部（如画布节点操作面板）请求把素材名 @ 插入输入框
  useEffect(() => {
    if (!pendingMention) return;
    insertSkillIntoComposer(pendingMention.name);
    onMentionConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMention?.nonce]);

  const handleSend = () => {
    const text = composerRef.current?.innerText.trim() || "";
    if (!text) return;
    setMessages((prev) => [
      ...prev,
      { id: Date.now(), type: "user", text },
      { id: Date.now() + 1, type: "agent", text: "收到，正在处理你的请求。" },
    ]);
    if (composerRef.current) composerRef.current.innerText = "";
    setComposerEmpty(true);
    setTimeout(() => {
      bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
    }, 50);
  };

  const handleScrollToBottom = () => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  };

  if (!isOpen) return null;

  const panelPath = squirclePath(panelSize.w, panelSize.h, 28.8);

  return (
    <div
      ref={panelRef}
      className="tc-agent-chat-panel tc-agent-chat-panel--fixed fixed right-4 top-[68px] bottom-[70px] z-[2147483600] flex flex-col overflow-hidden"
      style={{
        width: "var(--tc-agent-panel-width, 468px)",
        boxShadow: "0 16px 48px rgba(0, 0, 0, 0.5)",
      }}
      role="dialog"
      aria-label="Canvas Agent 对话"
    >
      <SmoothCorners
        width={panelSize.w}
        height={panelSize.h}
        path={panelPath}
        overlay={false}
        className="tc-agent-panel-shell absolute inset-0"
        style={{
          position: "absolute",
          inset: 0,
          display: "block",
          background: "rgba(41, 41, 41, 0.75)",
          backdropFilter: "blur(40px)",
          boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.04)",
        }}
      >
        {null}
      </SmoothCorners>

      <div
        className="relative flex h-full flex-col overflow-hidden rounded-[28.8px]"
        style={{ flex: "1 1 0%", minHeight: 0 }}
      >
        <div className="tc-agent-chat-header flex flex-shrink-0 items-center justify-between gap-2 px-1.5 py-1.5">
          <div lang="zh-CN" dir="ltr" style={{ display: "contents" }}>
            <div className="tc-agent-session-credit-badge group relative">
              <span
                className="tc-agent-session-credit-badge__trigger inline-flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.06] px-2 py-1 text-xs text-white/75"
                aria-label="当前 Agent 对话累计消耗 0.12 积分"
              >
                <CreditIcon size={12} />
                <span>0.1</span>
              </span>
              <div
                className="tc-agent-session-credit-badge__tooltip pointer-events-none absolute left-1/2 -top-2 z-[10] -translate-x-1/2 -translate-y-full opacity-0 transition-opacity group-hover:opacity-100"
                role="tooltip"
              >
                <div className="whitespace-nowrap rounded-lg border border-white/[0.08] bg-[#1a1a1a]/95 px-2.5 py-1.5 text-[11px] leading-4 shadow-lg">
                  <div className="tc-agent-session-credit-badge__tooltip-title text-white/55">当前 Agent 对话累计消耗积分</div>
                  <div className="tc-agent-session-credit-badge__tooltip-value text-white/90">0.12 积分</div>
                </div>
              </div>
            </div>
          </div>
          <div className="inline-flex items-center gap-0.5">
            <div className="relative inline-flex">
              <div className="relative">
                <button
                  type="button"
                  className="tc-agent-chrome-btn inline-flex h-6 w-6 items-center justify-center p-1 text-white/45 hover:text-white"
                  aria-label="浮动"
                  title="浮动"
                  style={{
                    background: "transparent",
                    border: "none",
                    transition: "color 120ms ease",
                    clipPath: `path('${squirclePath(24, 24, 10.8)}')`,
                  }}
                >
                  <svg width={16} height={16} viewBox="0 0 20 20" fill="none" aria-hidden="true" className="block">
                    <rect x="3.5" y="9.5" width="7" height="5" rx="1" fill="currentColor" />
                    <rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="relative inline-flex">
              <div className="relative">
                <button
                  type="button"
                  onClick={onClose}
                  className="tc-agent-chrome-btn inline-flex h-6 w-6 items-center justify-center p-1 text-white/45 hover:text-white"
                  aria-label="关闭"
                  title="关闭"
                  style={{
                    background: "transparent",
                    border: "none",
                    transition: "color 120ms ease",
                    clipPath: `path('${squirclePath(24, 24, 10.8)}')`,
                  }}
                >
                  <IconClose size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div
          className="tc-agent-chat-body-wrap"
          style={{ flex: "1 1 0%", position: "relative", minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}
        >
          <div
            ref={bodyRef}
            className="tc-agent-chat-body tc-panel-textarea-scrollbar flex flex-col gap-2 overflow-y-auto overflow-x-hidden px-3 py-2"
            style={{ flex: "1 1 0%", minHeight: 0 }}
          >
            {messages.map((msg) => {
              if (msg.type === "user") return <UserMessageBubble key={msg.id} text={msg.text} />;
              if (msg.type === "thinking") return <ThinkingBlock key={msg.id} msg={msg} />;
              if (msg.type === "card") return <AgentCard key={msg.id} msg={msg} />;
              return <AgentMessageBubble key={msg.id} text={msg.text} />;
            })}
          </div>
        </div>

        {showScrollButton && (
          <button
            type="button"
            onClick={handleScrollToBottom}
            className="absolute bottom-24 left-1/2 z-[20] -translate-x-1/2 inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.1] px-2.5 py-1 text-[11px] text-white/90 backdrop-blur-md shadow-lg transition-all hover:bg-white/[0.15]"
            aria-label="滚动到底部"
          >
            <ChevronDown width={12} height={12} />
            <span>新消息</span>
          </button>
        )}

        <div className="tc-agent-composer-outer flex-shrink-0" style={{ padding: "0 4px 4px" }}>
          <div style={{ position: "relative" }}>
            <ComposerShell>
              <div className="relative p-2">
                <div
                  ref={composerRef}
                  className="tc-agent-composer-editor min-h-[40px] max-h-[120px] overflow-y-auto px-3 py-2 text-sm text-white outline-none"
                  data-placeholder="描述你的想法，使用 @ 引用素材"
                  contentEditable
                  suppressContentEditableWarning
                  role="textbox"
                  aria-multiline="true"
                  data-empty={composerEmpty}
                  data-tour-editor="agent-composer-input"
                  spellCheck={false}
                  autoCorrect="off"
                  onInput={handleComposerInput}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                />
                <div className="tc-agent-composer-actions mt-2 flex items-center justify-between" aria-label="Composer actions">
                  <div className="tc-agent-composer-actions__start flex items-center gap-1">
                    <div lang="zh-CN" dir="ltr" style={{ display: "contents" }}>
                      <button
                        type="button"
                        className="tc-agent-upload-btn tc-agent-composer-icon-btn inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/[0.08]"
                        aria-label="上传素材"
                        data-tooltip="上传图片、视频或音频"
                      >
                        <IconPlus size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setSkillPanelOpen(true)}
                        className="tc-agent-skill-btn tc-agent-composer-pill-btn inline-flex h-8 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.05] px-3 text-xs font-medium text-white/85 transition-colors hover:bg-white/[0.08]"
                        aria-label="技能"
                        aria-haspopup="dialog"
                        aria-expanded={skillPanelOpen}
                        aria-controls="tc-agent-skill-panel"
                        data-tour-target="agent-skill-button"
                      >
                        <span className="tc-agent-skill-btn__content inline-flex items-center gap-1.5">
                          <BookOpenText size={16} />
                          <span className="tc-agent-skill-btn__label">技能</span>
                        </span>
                      </button>
                    </div>
                  </div>
                  <div className="tc-agent-composer-actions__end flex items-center gap-1">
                    <div lang="zh-CN" dir="ltr" style={{ display: "contents" }}>
                      <div className="tc-model-settings-selector relative">
                        <button
                          type="button"
                          ref={modelSettingsTriggerRef}
                          onClick={() => setModelSettingsOpen((v) => !v)}
                          className="tc-model-settings-trigger tc-agent-composer-icon-btn inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/[0.08]"
                          aria-haspopup="dialog"
                          aria-expanded={modelSettingsOpen}
                          aria-label={`模式与模型: ${selectedMode.label} · ${selectedModel.label}`}
                          title="模式与模型"
                        >
                          <Box size={16} />
                        </button>

                        {modelSettingsOpen && (
                          <ModelSettingsMenu
                            mode={selectedMode}
                            model={selectedModel}
                            modes={CREATION_MODES}
                            models={AGENT_MODELS}
                            onModeChange={setSelectedMode}
                            onModelChange={setSelectedModel}
                            onClose={() => setModelSettingsOpen(false)}
                            menuRef={modelSettingsMenuRef}
                            triggerRef={modelSettingsTriggerRef}
                          />
                        )}
                      </div>
                    </div>
                    <div lang="zh-CN" dir="ltr" style={{ display: "contents" }}>
                      <button
                        type="button"
                        onClick={handleSend}
                        disabled={composerEmpty}
                        className="tc-agent-send-btn tc-agent-composer-icon-btn inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white text-black transition-colors hover:bg-white/90 disabled:cursor-default disabled:bg-white/[0.1] disabled:text-white/[0.25]"
                        aria-label="发送"
                        aria-disabled={composerEmpty}
                      >
                        <IconSend size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </ComposerShell>
          </div>
        </div>
      </div>

      <SkillPanel
        isOpen={skillPanelOpen}
        onClose={() => setSkillPanelOpen(false)}
        onUseSkill={insertSkillIntoComposer}
      />
    </div>
  );
}

function ZoomControls({
  containerRef,
  viewport,
  setViewport,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  viewport: Viewport;
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
}) {
  const zoomBy = useCallback(
    (factor: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const cx = rect ? rect.width / 2 : 0;
      const cy = rect ? rect.height / 2 : 0;
      const worldX = (cx - viewport.x) / viewport.scale;
      const worldY = (cy - viewport.y) / viewport.scale;
      const newScale = Math.min(3, Math.max(0.1, viewport.scale * factor));
      setViewport({
        x: cx - worldX * newScale,
        y: cy - worldY * newScale,
        scale: newScale,
      });
    },
    [containerRef, viewport, setViewport]
  );

  return (
    <div className="tc-ui-fade-in absolute bottom-4 right-4 z-[150] opacity-100">
      <div className="tc-bottom-right-panel flex items-center gap-1 rounded-[18px] bg-[#171717] p-1 border border-white/[0.04]">
        <div className="flex items-center">
          <button
            type="button"
            aria-label="缩小"
            onClick={() => zoomBy(0.9)}
            className="tc-ui-glow-btn flex h-7 w-7 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/[0.08]"
          >
            <Minus width={12} height={12} />
          </button>
          <button
            type="button"
            aria-label="缩放 100%"
            aria-expanded="false"
            className="tc-ui-glow-btn inline-flex h-7 w-16 items-center justify-end gap-1.5 rounded-lg px-1.5 text-xs font-medium text-white/95 transition-colors hover:bg-white/[0.08]"
          >
            <span className="relative z-[1] flex-1 text-right">{Math.round(viewport.scale * 100)}%</span>
            <ChevronDown width={11} height={11} stroke="rgba(255,255,255,0.8)" />
          </button>
          <button
            type="button"
            aria-label="放大"
            onClick={() => zoomBy(1.1)}
            className="tc-ui-glow-btn flex h-7 w-7 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/[0.08]"
          >
            <Plus width={12} height={12} />
          </button>
        </div>
        <div className="mx-0.5 h-4 w-px bg-white/[0.06]" />
        <button
          type="button"
          aria-label="键盘快捷键"
          className="tc-ui-glow-btn flex h-7 w-7 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/[0.08]"
        >
          <svg
            width={18}
            height={18}
            viewBox="0 0 18 18"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="block"
          >
            <rect x="2" y="5" width="14" height="10" rx="1.5" />
            <line x1="5" y1="12" x2="13" y2="12" />
            <line x1="5" y1="8" x2="5" y2="8.01" />
            <line x1="9" y1="8" x2="9" y2="8.01" />
            <line x1="13" y1="8" x2="13" y2="8.01" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function CanvasPageInner() {
  const searchParams = useSearchParams();
  const prompt = searchParams.get("prompt") || "";

  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAgentOpen, setIsAgentOpen] = useState(true);
  const [isBottomDockOpen, setIsBottomDockOpen] = useState(false);
  const [bottomDockMode, setBottomDockMode] = useState<"image" | "video">("image");
  const [imageDockMedia, setImageDockMedia] = useState<DockMediaItem[]>([]);
  const [videoDockMedia, setVideoDockMedia] = useState<DockMediaItem[]>([]);
  const [agentPendingMention, setAgentPendingMention] = useState<{ name: string; nonce: number } | null>(null);

  // 画布素材节点操作面板的统一动作分发
  const handleNodeAction = useCallback(
    (node: NodeItem, actionId: string) => {
      const name = node.content || "未命名素材";
      switch (actionId) {
        case "refresh": {
          // 重新编辑：唤起底部图片 Dock（不带素材）
          setBottomDockMode("image");
          setIsBottomDockOpen(true);
          break;
        }
        case "shuffle": {
          // 再创作：带入参考图占位 + 唤起图片 Dock
          if (node.imageUrl) {
            setImageDockMedia([{ id: node.id, type: "image", name, src: node.imageUrl }]);
          }
          setBottomDockMode("image");
          setIsBottomDockOpen(true);
          break;
        }
        case "mention": {
          // 添加到对话：打开右侧面板并 @ 素材名
          setIsAgentOpen(true);
          setAgentPendingMention({ name, nonce: Date.now() });
          break;
        }
        case "video": {
          // 生成视频：带入参考图占位 + 唤起视频 Dock
          if (node.imageUrl) {
            setVideoDockMedia([{ id: node.id, type: "image", name, src: node.imageUrl }]);
          }
          setBottomDockMode("video");
          setIsBottomDockOpen(true);
          break;
        }
        case "info": {
          // 详情信息：暂忽略，后续补充
          break;
        }
        case "download": {
          // 下载：仅图片素材
          if (node.imageUrl) {
            const a = document.createElement("a");
            a.href = node.imageUrl;
            a.download = name || "image";
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }
          break;
        }
        default:
          break;
      }
    },
    []
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (!selectedId) return;
      e.preventDefault();
      setNodes((prev) => prev.filter((n) => n.id !== selectedId));
      setSelectedId(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId]);

  useEffect(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    setViewport({ x: cx, y: cy, scale: 1 });
  }, []);

  const addNode = useCallback(
    (type: NodeType, extra?: Partial<NodeItem>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const cx = rect ? rect.width / 2 : 0;
      const cy = rect ? rect.height / 2 : 0;
      const worldX = (cx - viewport.x) / viewport.scale;
      const worldY = (cy - viewport.y) / viewport.scale;
      const id = `${type}-${Date.now()}`;
      const base: NodeItem =
        type === "text"
          ? {
              id,
              type,
              x: worldX - 100,
              y: worldY - 24,
              width: 200,
              height: 48,
              content: "文本节点",
            }
          : {
              id,
              type,
              x: worldX - 120,
              y: worldY - 120,
              width: 240,
              height: 240,
              content: "占位图片节点",
            };
      const node: NodeItem = { ...base, ...extra, id: base.id };
      setNodes((prev) => [...prev, node]);
      setSelectedId(id);
    },
    [viewport]
  );

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const url = ev.target?.result as string | undefined;
        if (url) {
          addNode("image", {
            content: file.name,
            imageUrl: url,
          });
        }
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    },
    [addNode]
  );

  const handleToolClick = useCallback(
    (id: string) => {
      if (id === "upload") {
        handleUploadClick();
      } else if (id === "ai-image") {
        setBottomDockMode("image");
        setIsBottomDockOpen((open) => {
          if (bottomDockMode === "image" && open) {
            return false;
          }
          return true;
        });
      } else if (id === "ai-video") {
        setBottomDockMode("video");
        setIsBottomDockOpen((open) => {
          if (bottomDockMode === "video" && open) {
            return false;
          }
          return true;
        });
      } else if (id === "text") {
        addNode("text");
      }
    },
    [addNode, bottomDockMode, handleUploadClick]
  );

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-black text-white">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={handleFileChange}
        aria-hidden="true"
      />
      <TopBar />
      <TopBarCenter />
      <TopBarRight
        isAgentOpen={isAgentOpen}
        onAgentToggle={() => setIsAgentOpen((v) => !v)}
      />

      <CanvasSurface
        containerRef={containerRef}
        viewport={viewport}
        nodes={nodes}
        selectedId={selectedId}
        setViewport={setViewport}
        setNodes={setNodes}
        setSelectedId={setSelectedId}
        onNodeAction={handleNodeAction}
      />

      <LeftToolbar onToolClick={handleToolClick} />
      {isBottomDockOpen && (
        <BottomDock
          mode={bottomDockMode}
          onClose={() => setIsBottomDockOpen(false)}
          imageMedia={imageDockMedia}
          videoMedia={videoDockMedia}
          onRemoveImageMedia={(id) => setImageDockMedia((prev) => prev.filter((m) => m.id !== id))}
          onRemoveVideoMedia={(id) => setVideoDockMedia((prev) => prev.filter((m) => m.id !== id))}
        />
      )}
      <AgentChatPanel
        prompt={prompt}
        isOpen={isAgentOpen}
        onClose={() => setIsAgentOpen(false)}
        pendingMention={agentPendingMention}
        onMentionConsumed={() => setAgentPendingMention(null)}
      />
      <ZoomControls
        containerRef={containerRef}
        viewport={viewport}
        setViewport={setViewport}
      />

      <Link
        href="/"
        className="absolute bottom-4 left-4 z-[400] inline-flex h-8 items-center gap-1.5 rounded-full bg-[#141414]/90 px-3 text-xs font-medium text-white/70 border border-white/[0.04] backdrop-blur-md transition-colors hover:bg-white/[0.06] hover:text-white"
      >
        <ArrowLeft width={14} height={14} />
        返回首页
      </Link>
    </div>
  );
}

export default function CanvasPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-screen items-center justify-center bg-black text-white/60 text-sm">
          加载画布…
        </div>
      }
    >
      <CanvasPageInner />
    </Suspense>
  );
}
