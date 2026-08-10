"use client";

// IK74V6：视频 Dock 浮层组件（从 VideoDockContent 下沉）。
/**
 * VideoDockContent —— AI 视频生成 Dock 表单（展示层，受控组件）
 * 承载视频提示词与模型/宽高比/分辨率/时长/数量/参考模式等完整配置。
 * 状态由 BottomDock 提升并以 props 受控传入，本组件仅负责渲染与回调。
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { AspectRatioIcon } from "@/components/icons/AspectRatioIcon";
import { QUANTITIES } from "../../constants";

import { durationBounds, durationTicks } from "./video-dock-lib";

type OptionItem = { id: string; label: string };

/** 模型与质量设置面板（模型下拉/分辨率/比例/时长滑块）。 */
export function VideoModelSettingsPanel({
  pos,
  menuRef,
  selectedModel,
  models,
  onModelChange,
  resolution,
  resolutionOptions,
  onResolutionChange,
  aspectRatio,
  aspectRatioOptions,
  onAspectRatioChange,
  duration,
  onDurationChange,
  capability,
}: {
  pos: { left: number; bottom: number };
  menuRef: React.RefObject<HTMLDivElement | null>;
  selectedModel: OptionItem;
  models: OptionItem[];
  onModelChange: (m: OptionItem) => void;
  resolution: OptionItem;
  resolutionOptions: OptionItem[];
  onResolutionChange: (r: OptionItem) => void;
  aspectRatio: OptionItem;
  aspectRatioOptions: OptionItem[];
  onAspectRatioChange: (r: OptionItem) => void;
  duration: number;
  onDurationChange: (d: number) => void;
  capability: import("../../api/generation").ImageModelCapability | undefined;
}) {
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [resolutionDropdownOpen, setResolutionDropdownOpen] = useState(false);
  const { min: durMin, max: durMax, step: durStep } = durationBounds(capability);
  const durTicks = durationTicks(capability);
  const handleModelChange = onModelChange;
  if (typeof document === "undefined") return null;
  return createPortal(
          <div
            ref={menuRef}
            data-tc-dock-popover=""
            style={{
              position: "fixed",
              left: pos.left,
              bottom: pos.bottom,
              width: "max-content",
              minWidth: 320,
              padding: "4px 8px",
              borderRadius: 8,
              background: "var(--tc-dock-popup-bg)",
              border: "1px solid var(--tc-menu-pill-border)",
              boxShadow: "var(--tc-dock-popup-shadow)",
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
                  color: "var(--tc-dock-text-caption)",
                  fontWeight: 500,
                  padding: "0px 4px",
                }}
              >
                模型与质量
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                {/* 模型下拉 */}
                <div
                  style={{ width: 224, flexShrink: 0, position: "relative" }}
                >
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
                      border: "1px solid var(--tc-border-subtle)",
                      background: "var(--tc-dock-fill-faint)",
                      color: "var(--tc-text-primary)",
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
                        color: "var(--tc-text-primary)",
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
                  {modelDropdownOpen && (
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 6px)",
                        left: 0,
                        zIndex: 10,
                        background: "var(--tc-dock-popup-bg)",
                        border: "1px solid var(--tc-menu-pill-border)",
                        borderRadius: 8,
                        padding: 4,
                        boxShadow: "var(--tc-dock-popup-shadow)",
                        minWidth: 224,
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      {models.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            handleModelChange(m);
                            setModelDropdownOpen(false);
                          }}
                          style={{
                            height: 32,
                            padding: "0px 8px",
                            borderRadius: 6,
                            border: 0,
                            background:
                              selectedModel.id === m.id
                                ? "var(--tc-menu-item-hover)"
                                : "transparent",
                            color: "var(--tc-text-primary)",
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
                      border: "1px solid var(--tc-border-subtle)",
                      background: "var(--tc-dock-fill-faint)",
                      color: "var(--tc-text-primary)",
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
                        color: "var(--tc-text-primary)",
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
                    <ChevronDown
                      width={14}
                      height={14}
                      style={{ opacity: 0.6, marginLeft: "auto" }}
                    />
                  </button>
                  {resolutionDropdownOpen && (
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 6px)",
                        left: 0,
                        zIndex: 10,
                        background: "var(--tc-dock-popup-bg)",
                        border: "1px solid var(--tc-menu-pill-border)",
                        borderRadius: 8,
                        padding: 4,
                        boxShadow: "var(--tc-dock-popup-shadow)",
                        minWidth: 224,
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      {resolutionOptions.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => {
                            onResolutionChange(r);
                            setResolutionDropdownOpen(false);
                          }}
                          style={{
                            height: 32,
                            padding: "0px 8px",
                            borderRadius: 6,
                            border: 0,
                            background:
                              resolution.id === r.id
                                ? "var(--tc-menu-item-hover)"
                                : "transparent",
                            color: "var(--tc-text-primary)",
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
                min={durMin}
                max={durMax}
                step={durStep}
                aria-label="时长"
                aria-valuetext={`${duration}s`}
                type="range"
                value={duration}
                onChange={(e) => onDurationChange(Number(e.target.value))}
                style={{
                  ["--tc-duration-slider-progress" as string]: `${
                    ((duration - durMin) / (durMax - durMin)) * 100
                  }%`,
                }}
              />
              <div className="tc-duration-slider__ticks" aria-hidden="true">
                <div className="tc-duration-slider__tick-track">
                  {durTicks.map((t) => (
                    <span
                      key={t}
                      className={`tc-duration-slider__tick${t === duration ? " tc-duration-slider__tick--active" : ""}`}
                      style={{
                        ["--tc-duration-slider-tick-position" as string]: `${
                          ((t - durMin) / (durMax - durMin)) * 100
                        }%`,
                      }}
                    />
                  ))}
                </div>
              </div>
              <div className="tc-duration-slider__limits" aria-hidden="true">
                <span>{durMin}s</span>
                <span>{durMax}s</span>
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
                  color: "var(--tc-dock-text-caption)",
                  fontWeight: 500,
                  padding: "0px 4px",
                }}
              >
                宽高比
              </div>
              <div
                style={{
                  display: "flex",
                  background: "var(--tc-dock-fill-faint)",
                  borderRadius: 8,
                  padding: 4,
                  gap: 2,
                }}
              >
                {aspectRatioOptions.map((r) => {
                  const selected = aspectRatio.id === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => onAspectRatioChange(r)}
                      style={{
                        flex: "1 1 0%",
                        height: 44,
                        border: 0,
                        borderRadius: 6,
                        background: selected
                          ? "var(--tc-menu-item-hover)"
                          : "transparent",
                        color: selected
                          ? "var(--tc-text-primary)"
                          : "var(--tc-dock-text-caption)",
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
                      <span
                        style={{ opacity: selected ? 1 : 0.6, flexShrink: 0 }}
                      >
                        <AspectRatioIcon
                          ratio={r.id}
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
                        {r.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>,
    document.body,
  );
}

/** 参考模式选择菜单。 */
export function VideoRefModeMenu({
  pos,
  menuRef,
  refMode,
  refModeOptions,
  onRefModeChange,
  onClose,
}: {
  pos: { left: number; bottom: number };
  menuRef: React.RefObject<HTMLDivElement | null>;
  refMode: OptionItem;
  refModeOptions: OptionItem[];
  onRefModeChange: (m: OptionItem) => void;
  onClose: () => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
          <div
            ref={menuRef}
            data-tc-tab-dropdown-menu="true"
            style={{
              position: "fixed",
              left: pos.left,
              bottom: pos.bottom,
              minWidth: 168,
              height: "fit-content",
              background: "var(--tc-dock-popover-bg)",
              backdropFilter: "blur(40px)",
              border: "1px solid var(--tc-menu-pill-border)",
              borderRadius: 8,
              padding: "8px 4px",
              zIndex: 2147483602,
              boxShadow: "var(--tc-dock-popover-shadow)",
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
            {refModeOptions.map((m) => {
              const selected = refMode.id === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onRefModeChange(m);
                    onClose();
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "8px 16px",
                    border: 0,
                    borderRadius: 4,
                    background: selected
                      ? "var(--tc-menu-item-hover)"
                      : "transparent",
                    color: selected
                      ? "var(--tc-text-primary)"
                      : "var(--tc-text-secondary)",
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
  );
}

/** 生成数量 + 联网搜索菜单。 */
export function VideoQuantityMenu({
  pos,
  menuRef,
  quantity,
  quantityMax,
  onQuantityChange,
  onClose,
}: {
  pos: { left: number; bottom: number };
  menuRef: React.RefObject<HTMLDivElement | null>;
  quantity: string;
  quantityMax: number;
  onQuantityChange: (q: string) => void;
  onClose: () => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
          <div
            ref={menuRef}
            data-tc-dock-popover=""
            role="listbox"
            aria-label="选择生成数量"
            style={{
              position: "fixed",
              left: pos.left,
              bottom: pos.bottom,
              width: "max-content",
              minWidth: 120,
              padding: "4px 8px",
              borderRadius: 8,
              background: "var(--tc-dock-popup-bg)",
              border: "1px solid var(--tc-menu-pill-border)",
              boxShadow: "var(--tc-dock-popup-shadow)",
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
            {QUANTITIES.filter(
              (q) => Number.parseInt(q, 10) <= quantityMax,
            ).map((q) => {
              const selected = quantity === q;
              return (
                <button
                  key={q}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onQuantityChange(q);
                    onClose();
                  }}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    border: 0,
                    borderRadius: 6,
                    background: selected
                      ? "var(--tc-menu-item-hover)"
                      : "transparent",
                    color: selected
                      ? "var(--tc-dock-text-strong)"
                      : "var(--tc-dock-text-caption)",
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
  );
}
