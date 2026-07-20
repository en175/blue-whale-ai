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
import { getImageModels, getVideoModels } from "../api/generation";
import type { ImageModelCapability, VideoModelCapability } from "../api/generation";

const LANGUAGES = ["简体中文", "English"];

// AI 音乐：后端无 API，静态占位
const MUSIC_MODELS = [{ id: "topview-music", label: "Topview Music" }];

type ResOption = { id: string; label: string };

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  // 基础
  const [lang, setLang] = useState(LANGUAGES[0]);
  const [langOpen, setLangOpen] = useState(false);
  // 图片
  const [imgModels, setImgModels] = useState<ImageModelCapability[]>([]);
  const [imgModel, setImgModel] = useState<ImageModelCapability | undefined>(undefined);
  const [imgRes, setImgRes] = useState<ResOption>({ id: "", label: "" });
  const [imgModelOpen, setImgModelOpen] = useState(false);
  const [imgResOpen, setImgResOpen] = useState(false);
  // 全能参考
  const [videoModels, setVideoModels] = useState<VideoModelCapability[]>([]);
  const [refModel, setRefModel] = useState<VideoModelCapability | undefined>(undefined);
  const [refRes, setRefRes] = useState<ResOption>({ id: "", label: "" });
  const [refModelOpen, setRefModelOpen] = useState(false);
  const [refResOpen, setRefResOpen] = useState(false);
  // 首尾帧
  const [frameModel, setFrameModel] = useState<VideoModelCapability | undefined>(undefined);
  const [frameRes, setFrameRes] = useState<ResOption>({ id: "", label: "" });
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

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([getImageModels(), getVideoModels()])
      .then(([imgs, vids]) => {
        if (cancelled) return;
        setImgModels(imgs);
        setVideoModels(vids);
        if (imgs[0]) {
          setImgModel(imgs[0]);
          const dr = imgs[0].supportedSizes.find((s) => s.id === imgs[0].defaultSize) ?? imgs[0].supportedSizes[0];
          setImgRes(dr ? { id: dr.id, label: dr.label } : { id: "", label: "" });
        }
        if (vids[0]) {
          setRefModel(vids[0]);
          setFrameModel(vids[0]);
          const dres = vids[0].supportedResolutions.find((r) => r.id === vids[0].defaultResolution) ?? vids[0].supportedResolutions[0];
          const resOpt = dres ? { id: dres.id, label: dres.label } : { id: "", label: "" };
          setRefRes(resOpt);
          setFrameRes(resOpt);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const handleImgModel = (m: ImageModelCapability) => {
    setImgModel(m);
    if (!m.supportedSizes.some((r) => r.id === imgRes.id)) {
      const dr = m.supportedSizes.find((s) => s.id === m.defaultSize) ?? m.supportedSizes[0];
      setImgRes(dr ? { id: dr.id, label: dr.label } : { id: "", label: "" });
    }
    setImgModelOpen(false);
  };

  const handleVideoModel = (
    m: VideoModelCapability,
    setModel: (m: VideoModelCapability) => void,
    setRes: (r: ResOption) => void,
    cur: ResOption,
  ) => {
    setModel(m);
    if (!m.supportedResolutions.some((r) => r.id === cur.id)) {
      const dr = m.supportedResolutions.find((r) => r.id === m.defaultResolution) ?? m.supportedResolutions[0];
      setRes(dr ? { id: dr.id, label: dr.label } : { id: "", label: "" });
    }
  };

  const resetDefault = () => {
    setLang(LANGUAGES[0]);
    if (imgModels[0]) handleImgModel(imgModels[0]);
    if (videoModels[0]) {
      handleVideoModel(videoModels[0], setRefModel, setRefRes, refRes);
      handleVideoModel(videoModels[0], setFrameModel, setFrameRes, frameRes);
    }
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
                  label={imgModel?.modelLabel ?? ""}
                >
                  {imgModels.map((m) => (
                    <Row key={m.modelId} selected={imgModel?.modelId === m.modelId} onClick={() => handleImgModel(m)}>
                      {m.modelLabel}
                    </Row>
                  ))}
                </Dropdown>
                <Dropdown
                  open={imgResOpen}
                  onToggle={() => setImgResOpen((v) => !v)}
                  label={imgRes.label}
                >
                  {(imgModel?.supportedSizes ?? []).map((r) => (
                    <Row key={r.id} selected={imgRes.id === r.id} onClick={() => { setImgRes({ id: r.id, label: r.label }); setImgResOpen(false); }}>
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
                  label={refModel?.modelLabel ?? ""}
                >
                  {videoModels.map((m) => (
                    <Row key={m.modelId} selected={refModel?.modelId === m.modelId} onClick={() => { handleVideoModel(m, setRefModel, setRefRes, refRes); setRefModelOpen(false); }}>
                      {m.modelLabel}
                    </Row>
                  ))}
                </Dropdown>
                <Dropdown
                  open={refResOpen}
                  onToggle={() => setRefResOpen((v) => !v)}
                  label={refRes.label}
                >
                  {(refModel?.supportedResolutions ?? []).map((r) => (
                    <Row key={r.id} selected={refRes.id === r.id} onClick={() => { setRefRes({ id: r.id, label: r.label }); setRefResOpen(false); }}>
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
                  label={frameModel?.modelLabel ?? ""}
                >
                  {videoModels.map((m) => (
                    <Row key={m.modelId} selected={frameModel?.modelId === m.modelId} onClick={() => { handleVideoModel(m, setFrameModel, setFrameRes, frameRes); setFrameModelOpen(false); }}>
                      {m.modelLabel}
                    </Row>
                  ))}
                </Dropdown>
                <Dropdown
                  open={frameResOpen}
                  onToggle={() => setFrameResOpen((v) => !v)}
                  label={frameRes.label}
                >
                  {(frameModel?.supportedResolutions ?? []).map((r) => (
                    <Row key={r.id} selected={frameRes.id === r.id} onClick={() => { setFrameRes({ id: r.id, label: r.label }); setFrameResOpen(false); }}>
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
