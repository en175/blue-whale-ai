"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { AspectRatioIcon } from "./icons/AspectRatioIcon";
import { getImageModels, type ImageModelCapability } from "@/app/canvas/_canvas/api/generation";

export type ImageModel = { id: string; label: string; icon?: string };
export type ImageResolution = { id: string; label: string };
export type ImageAspectRatio = { id: string; label: string };

export interface ImageModelSettingsPopoverProps {
  triggerRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  selectedModel: ImageModel;
  onModelChange: (model: ImageModel) => void;
  selectedResolution: ImageResolution;
  onResolutionChange: (resolution: ImageResolution) => void;
  selectedAspectRatio: ImageAspectRatio;
  onAspectRatioChange: (ratio: ImageAspectRatio) => void;
}

export function ImageModelSettingsPopover({
  triggerRef,
  open,
  onClose,
  selectedModel,
  onModelChange,
  selectedResolution,
  onResolutionChange,
  selectedAspectRatio,
  onAspectRatioChange,
}: ImageModelSettingsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 16, bottom: 64 });
  const [modelOpen, setModelOpen] = useState(false);
  const [resolutionOpen, setResolutionOpen] = useState(false);

  const [capabilities, setCapabilities] = useState<ImageModelCapability[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (capabilities) return;
    setLoading(true);
    getImageModels()
      .then((data) => setCapabilities(data))
      .catch(() => setCapabilities([]))
      .finally(() => setLoading(false));
  }, [open, capabilities]);

  const currentCapability = capabilities?.find((c) => c.model_id === selectedModel.id);

  // 模型兜底：若当前选择不在能力列表中，默认选中第一个启用模型
  useEffect(() => {
    if (!capabilities || capabilities.length === 0) return;
    if (!capabilities.some((c) => c.model_id === selectedModel.id)) {
      const first = capabilities[0];
      onModelChange({
        id: first.model_id,
        label: first.model_label,
        icon: first.icon ?? undefined,
      });
    }
  }, [capabilities, selectedModel.id, onModelChange]);

  // 分辨率兜底：切换模型后若当前分辨率不可用，重置为模型默认值
  useEffect(() => {
    if (!currentCapability) return;
    const sizes = currentCapability.supported_sizes;
    if (sizes.length === 0) return;
    if (!sizes.some((s) => s.id === selectedResolution.id)) {
      const def = sizes.find((s) => s.id === currentCapability.default_size) ?? sizes[0];
      onResolutionChange({ id: def.id, label: def.label });
    }
  }, [currentCapability, selectedResolution.id, onResolutionChange]);

  // 宽高比兜底：切换模型后若当前宽高比不可用，重置为模型默认值
  useEffect(() => {
    if (!currentCapability) return;
    const ratios = currentCapability.supported_aspect_ratios;
    if (ratios.length === 0) return;
    if (!ratios.includes(selectedAspectRatio.id)) {
      const def = ratios.includes(currentCapability.default_aspect_ratio)
        ? currentCapability.default_aspect_ratio
        : ratios[0];
      onAspectRatioChange({ id: def, label: def });
    }
  }, [currentCapability, selectedAspectRatio.id, onAspectRatioChange]);

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

  const models: ImageModel[] =
    capabilities?.map((c) => ({ id: c.model_id, label: c.model_label, icon: c.icon ?? undefined })) ?? [];
  const resolutions: ImageResolution[] = currentCapability?.supported_sizes.map((s) => ({
    id: s.id,
    label: s.label,
  })) ?? [];
  const aspectRatios: ImageAspectRatio[] =
    currentCapability?.supported_aspect_ratios.map((r) => ({ id: r, label: r })) ?? [];

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
              {selectedModel.icon ? (
                <img
                  alt=""
                  width={16}
                  height={16}
                  src={selectedModel.icon}
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    objectFit: "cover",
                    flexShrink: 0,
                  }}
                />
              ) : (
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    background: "rgba(255,255,255,0.1)",
                    flexShrink: 0,
                    display: "inline-block",
                  }}
                />
              )}
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
                {loading ? "加载中..." : selectedModel.label}
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
                    key={model.id}
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
                        selectedModel.id === model.id
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
                    {model.icon ? (
                      <img
                        alt=""
                        width={16}
                        height={16}
                        src={model.icon}
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 4,
                          objectFit: "cover",
                          flexShrink: 0,
                        }}
                      />
                    ) : (
                      <span
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 4,
                          background: "rgba(255,255,255,0.1)",
                          flexShrink: 0,
                          display: "inline-block",
                        }}
                      />
                    )}
                    <span style={{ fontWeight: 600 }}>{model.label}</span>
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
                cursor: resolutions.length === 0 ? "default" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
                transition: "background 100ms",
                whiteSpace: "nowrap",
                width: "100%",
                boxSizing: "border-box",
                justifyContent: "space-between",
              }}
              disabled={resolutions.length === 0}
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
                {selectedResolution.label}
              </span>
              <ChevronDown
                width={14}
                height={14}
                style={{ opacity: 0.6, marginLeft: "auto" }}
              />
            </button>
            {resolutionOpen && resolutions.length > 0 && (
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
                {resolutions.map((res) => (
                  <button
                    key={res.id}
                    type="button"
                    onClick={() => {
                      onResolutionChange(res);
                      setResolutionOpen(false);
                    }}
                    style={{
                      height: 32,
                      padding: "0px 8px",
                      borderRadius: 6,
                      border: 0,
                      background:
                        selectedResolution.id === res.id
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
          {aspectRatios.map((ratio) => {
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
    </div>
  ,
  body
);
}
