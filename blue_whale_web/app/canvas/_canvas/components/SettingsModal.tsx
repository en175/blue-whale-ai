/**
 * SettingsModal —— 画布顶部「系统设置」居中弹窗（展示层）
 *
 * 复刻竞品布局：基础（语言）+ 默认模型（图片/全能参考/首尾帧/AI音乐，
 * 前三类模型+分辨率双下拉并排，AI音乐单下拉）+ 恢复默认。
 *
 * 数据源：
 * - 语言：本地枚举（简体中文 / English）。
 * - 图片模型/分辨率：复用 ImageModelSettingsPopover 静态 IMAGE_MODELS（与 BottomDock 同源）。
 * - 全能参考 / 首尾帧 / AI音乐：后端暂无模型 API，用静态占位（竞品同款值），
 *   待后端出对应 capability 接口后替换。选择态仅本地持有，暂不接生成流程。
 *
 * 关闭：右上 × / Escape / 点 overlay。
 */
"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import {
  IMAGE_MODELS,
  defaultResolutionOf,
  type ImageModel,
  type ImageResolution,
} from "@/components/ImageModelSettingsPopover";

const LANGUAGES = ["简体中文", "English"];

// 全能参考 / 首尾帧：视频类模型，后端无 API，静态占位（竞品同款）
const VIDEO_MODELS = [{ id: "seedance-2.0", label: "Seedance 2.0" }];
const VIDEO_RESOLUTIONS = [
  { id: "720p", label: "720p" },
  { id: "1080p", label: "1080p" },
];

// AI 音乐：后端无 API，静态占位
const MUSIC_MODELS = [{ id: "topview-music", label: "Topview Music" }];

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  // 基础
  const [lang, setLang] = useState(LANGUAGES[0]);
  const [langOpen, setLangOpen] = useState(false);
  // 图片
  const [imgModel, setImgModel] = useState<ImageModel>(IMAGE_MODELS[0]);
  const [imgRes, setImgRes] = useState<ImageResolution>(defaultResolutionOf(IMAGE_MODELS[0]));
  const [imgModelOpen, setImgModelOpen] = useState(false);
  const [imgResOpen, setImgResOpen] = useState(false);
  // 全能参考
  const [refModel, setRefModel] = useState(VIDEO_MODELS[0]);
  const [refRes, setRefRes] = useState(VIDEO_RESOLUTIONS[0]);
  const [refModelOpen, setRefModelOpen] = useState(false);
  const [refResOpen, setRefResOpen] = useState(false);
  // 首尾帧
  const [frameModel, setFrameModel] = useState(VIDEO_MODELS[0]);
  const [frameRes, setFrameRes] = useState(VIDEO_RESOLUTIONS[0]);
  const [frameModelOpen, setFrameModelOpen] = useState(false);
  const [frameResOpen, setFrameResOpen] = useState(false);
  // AI 音乐
  const [music, setMusic] = useState(MUSIC_MODELS[0]);
  const [musicOpen, setMusicOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const handleImgModel = (m: ImageModel) => {
    setImgModel(m);
    if (!m.resolutions.some((r) => r.id === imgRes.id)) setImgRes(defaultResolutionOf(m));
    setImgModelOpen(false);
  };

  const resetDefault = () => {
    setLang(LANGUAGES[0]);
    setImgModel(IMAGE_MODELS[0]);
    setImgRes(defaultResolutionOf(IMAGE_MODELS[0]));
    setRefModel(VIDEO_MODELS[0]);
    setRefRes(VIDEO_RESOLUTIONS[0]);
    setFrameModel(VIDEO_MODELS[0]);
    setFrameRes(VIDEO_RESOLUTIONS[0]);
    setMusic(MUSIC_MODELS[0]);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[2147483610] flex items-center justify-center"
      style={{ background: "var(--tc-bg-overlay)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="系统设置"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "85vh",
          background: "var(--tc-bg-surface)",
          border: "1px solid var(--tc-bg-elevated)",
          borderRadius: 8,
          boxShadow: "rgba(0, 0, 0, 0.5) 0 24px 80px",
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 32px",
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--tc-text-primary)", margin: 0 }}>
            系统设置
          </h2>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            style={{
              width: 28,
              height: 28,
              border: 0,
              borderRadius: 6,
              background: "transparent",
              color: "var(--tc-text-secondary)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              lineHeight: 1,
              transition: "opacity 120ms",
            }}
          >
            <X size={18} />
          </button>
        </div>

        <Divider />

        {/* Body */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* 基础 */}
          <Section title="基础">
            <FieldRow label="语言">
              <Dropdown
                open={langOpen}
                onToggle={() => setLangOpen((v) => !v)}
                label={lang}
                width="100%"
              >
                {LANGUAGES.map((l) => (
                  <Row key={l} selected={lang === l} onClick={() => { setLang(l); setLangOpen(false); }}>
                    {l}
                  </Row>
                ))}
              </Dropdown>
            </FieldRow>
          </Section>

          <Divider />

          {/* 默认模型 */}
          <div style={{ padding: "20px 32px", display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--tc-text-primary)" }}>默认模型</div>
                <div style={{ fontSize: 12, color: "var(--tc-text-muted)", marginTop: 4 }}>
                  配置默认模型与分辨率，新任务将自动应用这些设置。
                </div>
              </div>
              <button
                type="button"
                onClick={resetDefault}
                style={{
                  flexShrink: 0,
                  padding: "6px 12px",
                  borderRadius: 4,
                  border: "1px solid var(--tc-border-subtle)",
                  background: "var(--tc-bg-elevated)",
                  color: "var(--tc-text-secondary)",
                  fontSize: 12,
                  cursor: "pointer",
                  transition: "background 120ms, color 120ms",
                }}
              >
                恢复默认
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* 图片 */}
              <FieldRow label="图片">
                <Dropdown
                  open={imgModelOpen}
                  onToggle={() => setImgModelOpen((v) => !v)}
                  label={imgModel.label}
                >
                  {IMAGE_MODELS.map((m) => (
                    <Row key={m.id} selected={imgModel.id === m.id} onClick={() => handleImgModel(m)}>
                      {m.label}
                    </Row>
                  ))}
                </Dropdown>
                <Dropdown
                  open={imgResOpen}
                  onToggle={() => setImgResOpen((v) => !v)}
                  label={imgRes.label}
                >
                  {imgModel.resolutions.map((r) => (
                    <Row key={r.id} selected={imgRes.id === r.id} onClick={() => { setImgRes(r); setImgResOpen(false); }}>
                      {r.label}
                    </Row>
                  ))}
                </Dropdown>
              </FieldRow>

              {/* 全能参考 */}
              <FieldRow label="全能参考">
                <Dropdown
                  open={refModelOpen}
                  onToggle={() => setRefModelOpen((v) => !v)}
                  label={refModel.label}
                >
                  {VIDEO_MODELS.map((m) => (
                    <Row key={m.id} selected={refModel.id === m.id} onClick={() => { setRefModel(m); setRefModelOpen(false); }}>
                      {m.label}
                    </Row>
                  ))}
                </Dropdown>
                <Dropdown
                  open={refResOpen}
                  onToggle={() => setRefResOpen((v) => !v)}
                  label={refRes.label}
                >
                  {VIDEO_RESOLUTIONS.map((r) => (
                    <Row key={r.id} selected={refRes.id === r.id} onClick={() => { setRefRes(r); setRefResOpen(false); }}>
                      {r.label}
                    </Row>
                  ))}
                </Dropdown>
              </FieldRow>

              {/* 首尾帧 */}
              <FieldRow label="首尾帧">
                <Dropdown
                  open={frameModelOpen}
                  onToggle={() => setFrameModelOpen((v) => !v)}
                  label={frameModel.label}
                >
                  {VIDEO_MODELS.map((m) => (
                    <Row key={m.id} selected={frameModel.id === m.id} onClick={() => { setFrameModel(m); setFrameModelOpen(false); }}>
                      {m.label}
                    </Row>
                  ))}
                </Dropdown>
                <Dropdown
                  open={frameResOpen}
                  onToggle={() => setFrameResOpen((v) => !v)}
                  label={frameRes.label}
                >
                  {VIDEO_RESOLUTIONS.map((r) => (
                    <Row key={r.id} selected={frameRes.id === r.id} onClick={() => { setFrameRes(r); setFrameResOpen(false); }}>
                      {r.label}
                    </Row>
                  ))}
                </Dropdown>
              </FieldRow>

              {/* AI 音乐 */}
              <FieldRow label="AI 音乐">
                <Dropdown
                  open={musicOpen}
                  onToggle={() => setMusicOpen((v) => !v)}
                  label={music.label}
                  width="100%"
                >
                  {MUSIC_MODELS.map((m) => (
                    <Row key={m.id} selected={music.id === m.id} onClick={() => { setMusic(m); setMusicOpen(false); }}>
                      {m.label}
                    </Row>
                  ))}
                </Dropdown>
              </FieldRow>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Divider() {
  return <div style={{ height: 1, background: "var(--tc-bg-elevated)" }} />;
}

/** Section：标题 + 内容（基础段）。 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ padding: "20px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--tc-text-primary)" }}>{title}</div>
      {children}
    </div>
  );
}

/** 字段行：左 label + 右控件（双下拉并排时各占一半）。 */
function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <span style={{ width: 72, flexShrink: 0, fontSize: 14, color: "var(--tc-text-secondary)" }}>{label}</span>
      <div style={{ flex: 1, display: "flex", gap: 8, minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}

/** 下拉触发器 + 浮层菜单。 */
function Dropdown({
  open,
  onToggle,
  label,
  width,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  width?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ position: "relative", flex: width ? "0 0 100%" : "1 1 0%", minWidth: 0 }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          height: 36,
          padding: "0 12px",
          width: "100%",
          boxSizing: "border-box",
          borderRadius: 4,
          border: "1px solid var(--tc-border-subtle)",
          background: "var(--tc-bg-elevated)",
          color: "var(--tc-text-primary)",
          fontSize: 14,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          transition: "background 120ms",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <ChevronDown width={14} height={14} stroke="var(--tc-text-muted)" style={{ flexShrink: 0 }} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 10,
            background: "var(--tc-bg-elevated)",
            border: "1px solid var(--tc-border-subtle)",
            borderRadius: 4,
            padding: 4,
            boxShadow: "rgba(0, 0, 0, 0.3) 0 4px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** 下拉选项行。 */
function Row({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 32,
        padding: "0 12px",
        borderRadius: 4,
        border: 0,
        background: selected ? "var(--tc-border-active)" : "transparent",
        color: selected ? "var(--tc-text-primary)" : "var(--tc-text-secondary)",
        fontSize: 14,
        fontWeight: selected ? 600 : 400,
        cursor: "pointer",
        textAlign: "left",
        transition: "background 100ms",
      }}
    >
      {children}
    </button>
  );
}
