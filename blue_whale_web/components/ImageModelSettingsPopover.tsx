"use client";

import { useRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { AspectRatioIcon } from "./icons/AspectRatioIcon";

export const IMAGE_MODELS = [
  {
    id: "gpt-image-2",
    label: "GPT Image 2",
    icon: "https://d1735p3aqhycef.cloudfront.net/aigc-web/public/ai-image-creation/models/openai.png",
  },
  { id: "nano-banana-2", label: "Nano Banana 2" },
  { id: "nano-banana-pro", label: "Nano Banana Pro" },
  { id: "seedream-5", label: "Seedream 5.0" },
];

export const IMAGE_ASPECT_RATIOS = [
  { id: "9:16", label: "9:16" },
  { id: "3:4", label: "3:4" },
  { id: "1:1", label: "1:1" },
  { id: "4:3", label: "4:3" },
  { id: "16:9", label: "16:9" },
  { id: "2:3", label: "2:3" },
  { id: "3:2", label: "3:2" },
  { id: "5:4", label: "5:4" },
  { id: "4:5", label: "4:5" },
  { id: "21:9", label: "21:9" },
  { id: "9:21", label: "9:21" },
  { id: "1:2", label: "1:2" },
  { id: "2:1", label: "2:1" },
];

export const IMAGE_RESOLUTIONS = [
  { id: "2k", label: "2K" },
  { id: "3k", label: "3K" },
  { id: "4k", label: "4K" },
];

export type ImageModel = (typeof IMAGE_MODELS)[number];
export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];
export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];

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
                {selectedModel.label}
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
                {IMAGE_MODELS.map((model) => (
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
                {selectedResolution.label}
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
                {IMAGE_RESOLUTIONS.map((res) => (
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
    </div>
  ,
  body
);
}
