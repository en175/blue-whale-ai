"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { AspectRatioIcon } from "./icons/AspectRatioIcon";
import type { ImageModelCapability } from "@/app/canvas/_canvas/api/generation";

/**
 * 桥接期常量：BottomDock 图片表单已迁移到 getImageModels() 能力表（IK21O6），
 * 此处仅 AgentComposer（Agent 入口，IK21O6 out of scope）继续消费。
 * 待后续子工单把 AgentComposer 迁到能力表后整体删除。
 */
export const IMAGE_MODELS = [
  {
    id: "doubao-seedream-5-0-260128",
    label: "Seedream 5.0 Lite",
    defaultResolutionId: "2k",
    stream: true,
    resolutions: [
      { id: "2k", label: "2K" },
      { id: "3k", label: "3K" },
      { id: "4k", label: "4K" },
    ],
  },
  {
    id: "doubao-seedream-4-5-251128",
    label: "Seedream 4.5",
    defaultResolutionId: "2k",
    stream: true,
    resolutions: [
      { id: "2k", label: "2K" },
      { id: "4k", label: "4K" },
    ],
  },
  {
    id: "doubao-seedream-4-0-250828",
    label: "Seedream 4.0",
    defaultResolutionId: "2k",
    stream: true,
    resolutions: [
      { id: "1k", label: "1K" },
      { id: "2k", label: "2K" },
      { id: "4k", label: "4K" },
    ],
  },
  {
    id: "doubao-seedream-3-0-t2i-250415",
    label: "Seedream 3.0 T2I",
    defaultResolutionId: "1024x1024",
    stream: false,
    resolutions: [
      { id: "512x512", label: "512 × 512" },
      { id: "1024x1024", label: "1024 × 1024" },
      { id: "2048x2048", label: "2048 × 2048" },
    ],
  },
];

export const IMAGE_ASPECT_RATIOS = [
  { id: "9:16", label: "9:16" },
  { id: "3:4", label: "3:4" },
  { id: "1:1", label: "1:1" },
  { id: "4:3", label: "4:3" },
  { id: "16:9", label: "16:9" },
  { id: "2:3", label: "2:3" },
  { id: "3:2", label: "3:2" },
  { id: "21:9", label: "21:9" },
];

export type ImageModel = (typeof IMAGE_MODELS)[number];
export type ImageResolution = ImageModel["resolutions"][number];
export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];

/** 取模型默认分辨率；缺省回退到第一个。 */
export function defaultResolutionOf(model: ImageModel): ImageResolution {
  return (
    model.resolutions.find((r) => r.id === model.defaultResolutionId) ??
    model.resolutions[0]
  );
}

export interface ImageModelSettingsPopoverProps {
  triggerRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  /** 可选模型列表（能力表驱动，getImageModels() 返回）。 */
  models: ImageModelCapability[];
  selectedModel: ImageModelCapability;
  onModelChange: (model: ImageModelCapability) => void;
  /** 所选分辨率档位（selectedModel.supported_sizes 的某项）。 */
  selectedSize: { id: string; label: string };
  onSizeChange: (size: { id: string; label: string }) => void;
  selectedAspectRatio: ImageAspectRatio;
  onAspectRatioChange: (ratio: ImageAspectRatio) => void;
  /** 联网搜索开关态。 */
  webSearch: boolean;
  onWebSearchChange: (v: boolean) => void;
  /** 是否显示联网开关（依所选模型 features.tools）。 */
  showWebSearch: boolean;
}

export function ImageModelSettingsPopover({
  triggerRef,
  open,
  onClose,
  models,
  selectedModel,
  onModelChange,
  selectedSize,
  onSizeChange,
  selectedAspectRatio,
  onAspectRatioChange,
  webSearch,
  onWebSearchChange,
  showWebSearch,
}: ImageModelSettingsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 16, bottom: 64 });
  const [modelOpen, setModelOpen] = useState(false);
  const [resolutionOpen, setResolutionOpen] = useState(false);

  useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({
        left: rect.left,
        bottom: window.innerHeight - rect.top + 8,
      });
    }
  }, [open, triggerRef]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, onClose, triggerRef]);

  if (!open) return null;

  const body = typeof document !== "undefined" ? document.body : null;
  if (!body) return null;

  return createPortal(
    <div
      ref={popoverRef}
      data-tc-dock-popover=""
      style={{
        position: "fixed",
        left: position.left,
        bottom: position.bottom,
        width: "max-content",
        minWidth: 320,
        padding: "4px 8px",
        borderRadius: 8,
        background: "rgb(30, 30, 30)",
        border: "1px solid rgba(255, 255, 255, 0.04)",
        boxShadow: "rgba(0, 0, 0, 0.25) 0px 4px 16px",
        zIndex: 2147483605,
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
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: "4px 0",
        }}
      >
        <div
          style={{
            fontSize: 12,
            color: "rgba(255, 255, 255, 0.45)",
            fontWeight: 500,
            padding: "0px 4px",
          }}
        >
          模型与质量
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {/* Model dropdown */}
          <div style={{ width: 224, flexShrink: 0, position: "relative" }}>
            <button
              type="button"
              onClick={() => setModelOpen((v) => !v)}
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
                {selectedModel.model_label}
              </span>
              <ChevronDown
                width={14}
                height={14}
                style={{ opacity: 0.6, marginLeft: "auto" }}
              />
            </button>
            {modelOpen && (
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
                {models.map((model) => (
                  <button
                    key={model.model_id}
                    type="button"
                    onClick={() => {
                      onModelChange(model);
                      setModelOpen(false);
                    }}
                    style={{
                      height: 32,
                      padding: "0px 8px",
                      borderRadius: 6,
                      border: 0,
                      background:
                        selectedModel.model_id === model.model_id
                          ? "rgba(255, 255, 255, 0.08)"
                          : "transparent",
                      color: "rgb(255, 255, 255)",
                      fontSize: 12,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      transition: "background 100ms",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{model.model_label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Resolution dropdown */}
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
              onClick={() => setResolutionOpen((v) => !v)}
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
                {selectedSize.label}
              </span>
              <ChevronDown
                width={14}
                height={14}
                style={{ opacity: 0.6, marginLeft: "auto" }}
              />
            </button>
            {resolutionOpen && (
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
                {selectedModel.supported_sizes.map((res) => (
                  <button
                    key={res.id}
                    type="button"
                    onClick={() => {
                      onSizeChange(res);
                      setResolutionOpen(false);
                    }}
                    style={{
                      height: 32,
                      padding: "0px 8px",
                      borderRadius: 6,
                      border: 0,
                      background:
                        selectedSize.id === res.id
                          ? "rgba(255, 255, 255, 0.08)"
                          : "transparent",
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
                    <span style={{ fontWeight: 600 }}>{res.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 宽高比 */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: "4px 0",
        }}
      >
        <div
          style={{
            fontSize: 12,
            color: "rgba(255, 255, 255, 0.45)",
            fontWeight: 500,
            padding: "0px 4px",
          }}
        >
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
          {IMAGE_ASPECT_RATIOS.map((ratio) => {
            const selected = selectedAspectRatio.id === ratio.id;
            return (
              <button
                key={ratio.id}
                type="button"
                onClick={() => onAspectRatioChange(ratio)}
                style={{
                  flex: "1 1 0%",
                  height: 44,
                  borderWidth: "medium",
                  borderStyle: "none",
                  borderColor: "currentcolor",
                  borderImage: "initial",
                  borderRadius: 6,
                  background: selected
                    ? "rgba(255, 255, 255, 0.08)"
                    : "transparent",
                  color: selected
                    ? "rgb(255, 255, 255)"
                    : "rgba(255, 255, 255, 0.45)",
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
                  <AspectRatioIcon
                    ratio={ratio.id}
                    width={14}
                    height={14}
                    filled={false}
                  />
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: selected ? 600 : 500,
                    lineHeight: "12px",
                  }}
                >
                  {ratio.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 联网搜索 */}
      {showWebSearch && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}>
          <div style={{ fontSize: 12, color: "var(--tc-text-muted)", fontWeight: 500, padding: "0px 4px" }}>
            联网搜索
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "7px 4px" }}>
            <span style={{ fontSize: 12, color: "var(--tc-text-secondary)", fontWeight: 400 }}>搜索最新网络信息辅助生成</span>
            <button
              type="button"
              role="switch"
              aria-checked={webSearch}
              aria-label="联网搜索"
              onClick={() => onWebSearchChange(!webSearch)}
              style={{
                position: "relative",
                width: 36,
                height: 20,
                borderRadius: 9999,
                border: 0,
                background: webSearch ? "var(--tc-accent)" : "var(--tc-border-active)",
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
                  left: webSearch ? 18 : 2,
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: "var(--tc-on-accent)",
                  transition: "left 150ms",
                }}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  ,
  body
);
}
