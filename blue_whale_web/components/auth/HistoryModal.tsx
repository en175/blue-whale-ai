"use client";

import { useEffect, useMemo } from "react";
import { X, Palette, MessageCircle } from "lucide-react";
import { loadHistory, seedDemoHistory, type HistoryItem } from "./historyStorage";

interface HistoryModalProps {
  onClose: () => void;
}

const typeMeta: Record<HistoryItem["type"], { icon: React.ReactNode; label: string }> = {
  canvas: { icon: <Palette size={13} />, label: "画布" },
  chat: { icon: <MessageCircle size={13} />, label: "对话" },
};

export function HistoryModal({ onClose }: HistoryModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const items = useMemo(() => {
    const existing = loadHistory();
    if (existing.length > 0) {
      return existing.sort((a, b) => b.createdAt - a.createdAt);
    }
    return seedDemoHistory().sort((a, b) => b.createdAt - a.createdAt);
  }, []);

  // 按日期分组
  const groups = useMemo(() => {
    const map = new Map<string, HistoryItem[]>();
    for (const item of items) {
      const dateLabel = formatDateLabel(item.createdAt);
      const group = map.get(dateLabel) ?? [];
      group.push(item);
      map.set(dateLabel, group);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <div
      className="fixed inset-0 z-[2147483610] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#1a1a1a] border border-white/[0.12] rounded-xl shadow-[0_24px_80px_rgba(0,0,0,0.5)] w-[480px] max-w-[calc(100vw-32px)] max-h-[80vh] flex flex-col relative"
        role="dialog"
        aria-modal="true"
        aria-label="历史记录"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] shrink-0">
          <h2 className="text-lg font-semibold text-white">历史记录</h2>
          <button
            type="button"
            className="inline-flex w-8 h-8 items-center justify-center rounded-lg text-white/45 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {groups.length === 0 ? (
            <p className="text-white/40 text-sm text-center py-12">暂无历史记录</p>
          ) : (
            groups.map(([dateLabel, groupItems]) => (
              <div key={dateLabel}>
                {/* 日期分组标题 */}
                <p className="text-[11px] text-white/35 font-medium mb-3 pl-1">
                  {dateLabel}
                </p>
                <div className="space-y-2">
                  {groupItems.map((item) => {
                    const meta = typeMeta[item.type] ?? typeMeta.canvas;
                    return (
                      <div
                        key={item.id}
                        className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/[0.04] hover:bg-white/[0.05] transition-colors"
                      >
                        {/* 缩略图占位 */}
                        <div className="w-14 h-14 rounded-md bg-white/[0.04] border border-white/[0.05] flex items-center justify-center shrink-0">
                          <span className="text-white/15 text-[10px]">预览</span>
                        </div>

                        {/* 内容 */}
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] text-white/85 leading-tight truncate">
                            {item.title}
                          </p>
                          <div className="flex items-center gap-2 mt-1.5">
                            {/* type badge */}
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white/[0.06] text-[11px] text-white/45">
                              {meta.icon}
                              {meta.label}
                            </span>
                            <span className="text-[11px] text-white/30">
                              {formatRelativeTime(item.createdAt)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}

function formatDateLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor((today.getTime() - target.getTime()) / 86400000);

  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays < 7) return `${diffDays} 天前`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
