"use client";
/**
 * HistoryModal —— 历史记录弹窗（占位）。
 *
 * 纯内存演示数据，首次为空显示「暂无记录」。不向用户 localStorage 写入假数据
 * （此前会 seed SEED_HISTORY，对占位而言过建且污染用户存储）。
 * 后端暂无历史 API，后续接入真实接口时替换数据源即可。
 */
import { useState } from "react";
import { ModalShell } from "./ModalShell";

interface HistoryModalProps {
  onClose: () => void;
}

type HistoryItem = {
  id: string;
  type: "canvas" | "chat";
  title: string;
  createdAt: string;
};

const TYPE_LABEL: Record<HistoryItem["type"], string> = {
  canvas: "画布",
  chat: "对话",
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return iso;
  }
}

export function HistoryModal({ onClose }: HistoryModalProps) {
  // 纯内存：首次为空（后续接入真实历史 API 时替换为后端数据）
  const [items] = useState<HistoryItem[]>([]);

  return (
    <ModalShell ariaLabel="历史记录" onClose={onClose}>
      <h2 className="text-[24px] font-semibold leading-tight mb-6 text-white">历史记录</h2>

      {items.length === 0 ? (
        <div className="py-10 text-center text-[13px] text-white/40">
          <div className="text-3xl mb-3 opacity-50">📭</div>
          暂无记录
        </div>
      ) : (
        <ul className="flex flex-col gap-1 max-h-[50vh] overflow-y-auto -mx-1 px-1">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.04] transition-colors cursor-default"
            >
              <span className="inline-flex items-center justify-center min-w-[44px] h-6 px-2 rounded text-[11px] text-white/65 bg-white/[0.06] border border-white/[0.08] select-none">
                {TYPE_LABEL[it.type]}
              </span>
              <span className="flex-1 text-[13px] text-white/85 truncate">{it.title}</span>
              <span className="text-[12px] text-white/35 tabular-nums select-none">
                {formatTime(it.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-[11px] text-white/30 text-center">历史功能即将上线</p>
    </ModalShell>
  );
}
