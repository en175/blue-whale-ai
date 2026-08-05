"use client";

/**
 * NodeInfoModal —— 节点「信息」按钮详情弹窗（IK6M68，最小实现）
 * 消除原「点了没反应」的空操作：展示节点类型/名称/描述/尺寸/时长/资产ID/状态/来源。
 * 与 IK2BJK 资产模型升级正交：本组件只读节点已有字段，不引入新数据模型。
 * 点击遮罩或 Esc 关闭（复用 MediaPreviewModal 交互范式，不引入第三方库）。
 */
import { useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { Asset, CanvasNode } from "../model";

const KIND_LABELS: Record<string, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  text: "文本",
  reference: "参考卡",
  product: "商品卡",
  group: "分组",
};

function fmtDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

export function NodeInfoModal({
  node,
  asset,
  onClose,
}: {
  node: CanvasNode;
  asset?: Asset;
  onClose: () => void;
}) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (typeof document === "undefined") return null;

  const kind = node.data.kind;
  const kindLabel =
    KIND_LABELS[kind] ??
    (node.data.cardType ? `${KIND_LABELS.reference}（${node.data.cardType}）` : kind);
  // content 未在 CanvasNodeData 显式声明（走 index signature 为 unknown），需窄化
  const content =
    typeof node.data.content === "string" ? node.data.content : undefined;
  const name = node.data.name ?? node.data.label ?? content;
  const width = asset?.width ?? node.width;
  const height = asset?.height ?? node.height;

  const rows: Array<{ label: string; value: string }> = [
    { label: "类型", value: kindLabel },
    { label: "名称", value: name ?? "—" },
  ];
  if (node.data.description) {
    rows.push({ label: "描述", value: node.data.description });
  } else if (node.data.detail) {
    rows.push({ label: "详情", value: node.data.detail });
  }
  if (node.data.prompt) rows.push({ label: "提示词", value: node.data.prompt });
  if (width && height) {
    rows.push({ label: "尺寸", value: `${Math.round(width)} × ${Math.round(height)}` });
  }
  if (asset?.duration) rows.push({ label: "时长", value: fmtDuration(asset.duration) });
  if (node.data.assetId) rows.push({ label: "资产 ID", value: node.data.assetId });
  if (node.data.status) {
    rows.push({
      label: "状态",
      value:
        node.data.status === "done"
          ? "已完成"
          : node.data.status === "running"
            ? "生成中"
            : node.data.status === "error"
              ? "失败"
              : node.data.status,
    });
  }
  if (node.data.recipe?.origin) {
    rows.push({
      label: "来源",
      value:
        node.data.recipe.origin === "generated"
          ? "AI 生成"
          : node.data.recipe.origin === "uploaded"
            ? "本地上传"
            : "派生",
    });
  }

  return createPortal(
    <div
      role="dialog"
      aria-label={`节点信息 ${name ?? kind}`}
      data-tc-dock-popover=""
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483646,
        background: "var(--tc-bg-overlay)",
        backdropFilter: "blur(12px)",
        boxShadow: "var(--tc-modal-shadow)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 360,
          maxWidth: "90vw",
          maxHeight: "80vh",
          overflowY: "auto",
          borderRadius: 14,
          background: "var(--tc-bg-surface)",
          border: "1px solid var(--tc-border-subtle)",
          padding: "18px 20px",
          cursor: "default",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "var(--tc-text-primary)",
            }}
          >
            节点信息
          </span>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              border: 0,
              background: "transparent",
              color: "var(--tc-text-muted)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X width={15} height={15} />
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {rows.map((row) => (
            <div
              key={row.label}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "8px 0",
                borderBottom: "1px solid var(--tc-border-subtle)",
                fontSize: 13,
                lineHeight: "18px",
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: 64,
                  color: "var(--tc-text-muted)",
                  fontWeight: 500,
                }}
              >
                {row.label}
              </span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  wordBreak: "break-all",
                  color: "var(--tc-text-primary)",
                }}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
