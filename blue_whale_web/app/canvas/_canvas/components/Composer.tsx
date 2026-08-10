/**
 * Composer —— 输入器外壳与模型设置菜单（展示 + 局部状态层）
 * ComposerShell：自适应尺寸的输入容器外壳；ModelSettingsMenu：生成模型参数设置浮层。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SmoothCorners } from "@/components/SmoothCorners";
import { squirclePath } from "../utils";
import type { ImageModelCapability } from "../api/generation";

/** 费用倍率占位：能力表暂不含 costMultiplier，统一 1x 待后续接入。 */
const AGENT_COST_MULTIPLIER = "1x";

export function ComposerShell({ children }: { children: React.ReactNode }) {
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
      <div className="relative overflow-hidden rounded-[25.2px]">
        {children}
      </div>
    </div>
  );
}

export function ModelSettingsMenu({
  model,
  models,
  onModelChange,
  onClose,
  menuRef,
  triggerRef,
}: {
  model: ImageModelCapability;
  models: ImageModelCapability[];
  onModelChange: (model: ImageModelCapability) => void;
  onClose: () => void;
  menuRef: React.RefObject<HTMLDivElement | null>;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
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
      aria-label="模型"
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
      <section className="tc-model-settings-section" aria-label="Agent 模型">
        <div className="tc-model-settings-section__title px-2 py-1.5 text-[11px] font-medium text-white/45">
          Agent 模型
        </div>
        <div className="tc-model-tier-menu__intro px-2 pb-1.5 text-[11px] leading-4 text-white/40">
          选择驱动 Agent 的模型。
        </div>
        {models.map((m) => {
          const selected = m.model_id === model.model_id;
          return (
            <button
              key={m.model_id}
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
                  {m.model_label}
                </span>
                <span
                  className="tc-model-tier-option__cost inline-flex items-center gap-1 text-[11px] text-white/45"
                  aria-label={`消耗 ${AGENT_COST_MULTIPLIER}`}
                >
                  <span
                    className="tc-model-tier-option__cost-icon"
                    aria-hidden="true"
                  >
                    💰
                  </span>
                  <span className="tc-model-tier-option__cost-label">消耗</span>
                  <span className="tc-model-tier-option__cost-rate">
                    {AGENT_COST_MULTIPLIER}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </section>
    </div>
  );
}
