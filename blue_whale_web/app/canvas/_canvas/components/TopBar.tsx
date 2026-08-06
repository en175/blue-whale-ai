/**
 * TopBar —— 画布顶部栏相关组件（展示层）
 * 包含项目下拉菜单 ProjectMenu、顶部左侧栏 TopBar（Logo + 项目切换 + 设置）、
 * 中部占位 TopBarCenter、右侧 Agent 入口 TopBarRight。
 */
import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  MessageSquare,
  Pencil,
  Settings,
  Trash2,
} from "lucide-react";
import type { Project } from "../types";
import { IconPlus } from "../icons";
import { UserMenu } from "@/components/auth/UserMenu";
import { CreditBalance } from "@/components/credits/CreditBalance";

export function ProjectMenu({
  open,
  onClose,
  projects,
  activeProjectId,
  onSwitch,
  onCreate,
  onDelete,
  onRename,
}: {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  activeProjectId: string;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onRename?: (id: string, rawName: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      className="tc-project-menu"
      style={{
        position: "absolute",
        top: "calc(100% + 2px)",
        left: 0,
        zIndex: 300,
        width: 280,
        borderRadius: 8,
        border: "1px solid rgba(255, 255, 255, 0.04)",
        background: "rgb(30, 30, 30)",
        padding: "4px 8px 8px",
        boxShadow: "rgba(0, 0, 0, 0.4) 0px 8px 24px",
      }}
    >
      <div
        style={{
          padding: "8px 16px 4px",
          fontSize: 11,
          color: "rgba(255, 255, 255, 0.4)",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}
      >
        Projects
      </div>
      <div style={{ maxHeight: 240, overflowY: "auto", margin: "4px 0" }}>
        {projects.map((p) => {
          const isActive = p.id === activeProjectId;
          return (
            <div
              key={p.id}
              className="group/project relative flex items-center"
              style={{
                padding: "6px 16px",
                borderRadius: 6,
                background: isActive
                  ? "rgba(255, 255, 255, 0.12)"
                  : "transparent",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  onSwitch(p.id);
                  onClose();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flex: "1 1 0%",
                  minWidth: 0,
                  padding: 0,
                  background: "none",
                  border: 0,
                  outline: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  color: isActive
                    ? "rgb(255, 255, 255)"
                    : "rgba(255, 255, 255, 0.7)",
                  fontSize: 14,
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    flexShrink: 0,
                    borderRadius: 6,
                    overflow: "hidden",
                    background: "rgba(255, 255, 255, 0.06)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {p.thumb ? (
                    <img
                      alt=""
                      src={p.thumb}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                  ) : (
                    <svg
                      width={14}
                      height={14}
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      aria-hidden="true"
                      style={{ opacity: 0.35, flexShrink: 0 }}
                    >
                      <line x1="5" y1="1" x2="5" y2="15" />
                      <line x1="11" y1="1" x2="11" y2="15" />
                      <line x1="1" y1="5" x2="15" y2="5" />
                      <line x1="1" y1="11" x2="15" y2="11" />
                    </svg>
                  )}
                </div>
                <span
                  style={{
                    flex: "1 1 0%",
                    minWidth: 0,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    fontWeight: isActive ? 600 : 400,
                    WebkitMaskImage:
                      "linear-gradient(to right, black calc(100% - 12px), transparent calc(100% + 0px))",
                    maskImage:
                      "linear-gradient(to right, black calc(100% - 12px), transparent calc(100% + 0px))",
                    transition: "mask-image 0.1s, -webkit-mask-image 0.1s",
                  }}
                >
                  {p.name}
                </span>
              </button>
              <button
                type="button"
                aria-label="Delete project"
                onClick={() => onDelete(p.id)}
                className="opacity-0 pointer-events-none group-hover/project:opacity-100 group-hover/project:pointer-events-auto"
                style={{
                  position: "absolute",
                  right: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: 24,
                  width: 24,
                  background: "rgba(239, 68, 68, 0.12)",
                  border: 0,
                  borderRadius: 6,
                  color: "rgb(239, 68, 68)",
                  fontSize: 12,
                  cursor: "pointer",
                  outline: "none",
                  transition: "background 0.1s, color 0.1s, opacity 0.1s",
                }}
              >
                <Trash2 width={14} height={14} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      <div
        style={{
          height: 1,
          background: "rgba(255, 255, 255, 0.06)",
          margin: "8px 0",
        }}
      />
      <button
        type="button"
        onClick={() => {
          if (!onRename) return;
          const current =
            projects.find((p) => p.id === activeProjectId)?.name ?? "";
          const raw = window.prompt("重命名项目", current);
          if (raw != null && raw.trim()) onRename(activeProjectId, raw.trim());
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          width: "100%",
          padding: "6px 16px",
          fontSize: 14,
          color: "rgba(255, 255, 255, 0.7)",
          background: "none",
          border: 0,
          borderRadius: 6,
          cursor: "pointer",
          textAlign: "left",
          outline: "none",
          transition: "background 0.1s, color 0.1s",
        }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Pencil width={14} height={14} aria-hidden="true" />
        </span>
        Rename Project
      </button>
      <button
        type="button"
        onClick={() => {
          onCreate();
          onClose();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          width: "100%",
          padding: "6px 16px",
          fontSize: 14,
          color: "rgba(255, 255, 255, 0.7)",
          background: "none",
          border: 0,
          borderRadius: 6,
          cursor: "pointer",
          textAlign: "left",
          outline: "none",
          transition: "background 0.1s, color 0.1s",
        }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <IconPlus size={16} />
        </span>
        New Project
      </button>
    </div>
  );
}

export function TopBar({
  activeProject,
  projects,
  onSwitch,
  onCreate,
  onDelete,
  onRename,
}: {
  activeProject: Project;
  projects: Project[];
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onRename?: (id: string, rawName: string) => void;
}) {
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);

  return (
    <div
      className="tc-top-bar-left tc-enter tc-enter--top tc-enter-d1"
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        zIndex: 150,
        pointerEvents: "auto",
        display: "flex",
        alignItems: "center",
        fontFamily: "Inter, -apple-system, sans-serif",
        gap: 4,
        padding: 2,
        background: "rgba(0, 0, 0, 0.55)",
        backdropFilter: "blur(12px)",
        borderRadius: 10,
      }}
    >
      <div style={{ position: "relative" }}>
        <button
          type="button"
          className="tc-logo-menu-btn"
          aria-label="导航菜单"
          aria-expanded={false}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: 0,
            padding: 0,
            cursor: "pointer",
            outline: "none",
          }}
        >
          <div
            style={{
              transform: "scale(0.85)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img
              src="/blue_whale.svg"
              alt="Blue-Whale"
              className="h-7 w-auto"
            />
          </div>
        </button>
      </div>
      <div
        style={{
          width: 1,
          height: 14,
          background: "rgba(255, 255, 255, 0.16)",
          flexShrink: 0,
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          position: "relative",
        }}
      >
        <button
          type="button"
          onClick={() => setProjectMenuOpen((v) => !v)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            maxWidth: 224,
            width: "fit-content",
            minWidth: 0,
            boxSizing: "border-box",
            background: "rgba(42, 42, 45, 0.72)",
            border: 0,
            padding: "4px 8px",
            borderRadius: 8,
            color: "rgb(255, 255, 255)",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            outline: "none",
            transition: "background 120ms",
            overflow: "hidden",
            gap: 4,
          }}
        >
          <span
            style={{
              flex: "0 1 auto",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              textAlign: "left",
            }}
          >
            {activeProject.name}
          </span>
          <ChevronDown
            width={14}
            height={14}
            stroke="rgba(255, 255, 255, 0.5)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ flexShrink: 0 }}
          />
        </button>
        <ProjectMenu
          open={projectMenuOpen}
          onClose={() => setProjectMenuOpen(false)}
          projects={projects}
          activeProjectId={activeProject.id}
          onSwitch={onSwitch}
          onCreate={onCreate}
          onDelete={onDelete}
          onRename={onRename}
        />
      </div>
      <div style={{ position: "relative", display: "inline-flex" }}>
        <button
          type="button"
          className="tc-shell-btn tc-top-bar-settings-btn"
          aria-label="系统设置"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: 8,
            background: "transparent",
            border: 0,
            color: "rgba(255, 255, 255, 0.8)",
            cursor: "pointer",
            outline: "none",
            transition: "background 120ms",
          }}
        >
          <Settings
            width={14}
            height={14}
            stroke="rgba(255, 255, 255, 0.8)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  );
}

export function TopBarCenter() {
  return null;
}

export function TopBarRight({
  isAgentOpen,
  onAgentToggle,
}: {
  isAgentOpen: boolean;
  onAgentToggle: () => void;
}) {
  return (
    <div className="tc-top-bar-right absolute top-4 right-4 z-[100] flex items-center">
      <div className="tc-top-bar-right__actions flex items-center gap-2">
        <CreditBalance />
        <UserMenu />
        <button
          type="button"
          onClick={onAgentToggle}
          className="tc-shell-btn tc-shell-btn--labeled inline-flex h-9 items-center gap-1.5 rounded-[18px] bg-[var(--tc-menu-pill-bg)] px-3 text-white border border-[var(--tc-menu-pill-border)] shadow-[var(--tc-menu-pill-shadow)] backdrop-blur-md transition-colors hover:bg-[var(--tc-menu-item-hover)] data-[active]:bg-white/[0.12] data-[active]:border-white/[0.10]"
          aria-label="Canvas Agent"
          data-active={isAgentOpen ? "" : undefined}
        >
          <MessageSquare
            width={18}
            height={18}
            stroke="rgba(255,255,255,0.8)"
            strokeWidth={1.5}
          />
          <span className="tc-shell-btn__label text-[13px] font-medium">
            Agent
          </span>
        </button>
      </div>
    </div>
  );
}
