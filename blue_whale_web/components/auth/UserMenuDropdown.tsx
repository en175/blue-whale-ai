"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { ChevronDown, User, Clock, Shield, LogOut } from "lucide-react";
import type { User as UserType } from "./types";
import { maskPhone } from "./phoneUtils";

export type ModalName = "profile" | "history" | "account" | "rebindPhone";

interface UserMenuDropdownProps {
  user: UserType;
  onOpenModal: (modal: ModalName) => void;
  onSignOut: () => void;
}

export function UserMenuDropdown({ user, onOpenModal, onSignOut }: UserMenuDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open, close]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const handleMenuItem = (modal: ModalName) => {
    onOpenModal(modal);
    close();
  };

  const handleSignOut = () => {
    close();
    onSignOut();
  };

  const initial = user.username?.charAt(0)?.toUpperCase() ?? "?";
  const hasAvatar = !!(user.avatar && user.avatar !== "0");

  return (
    <div ref={containerRef} className="relative">
      {/* 触发按钮 */}
      <button
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-2 h-9 px-2 rounded-[18px] text-[13px] text-white/85 border border-white/[0.08] hover:bg-white/[0.05] transition-colors select-none"
        aria-expanded={open}
        aria-haspopup="true"
      >
        {/* 圆形头像 */}
        {hasAvatar ? (
          <img src={user.avatar} alt="" className="w-6 h-6 rounded-full object-cover" />
        ) : (
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#3b82f6] text-white text-[11px] font-semibold leading-none">
            {initial}
          </span>
        )}
        <span className="max-w-[80px] truncate">{user.username}</span>
        <ChevronDown
          size={14}
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* 下拉面板 */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-[#2a2a2a] border border-white/[0.1] rounded-lg shadow-[0_16px_48px_rgba(0,0,0,0.4)] z-[200] overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
            {hasAvatar ? (
              <img src={user.avatar} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
            ) : (
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[#3b82f6] text-white text-sm font-semibold leading-none shrink-0">
                {initial}
              </span>
            )}
            <div className="min-w-0">
              <div className="text-sm text-white/90 truncate">{user.username}</div>
              <div className="text-[11px] text-white/40 mt-0.5">
                {maskPhone(user.phone)}
              </div>
            </div>
          </div>

          {/* 菜单项 */}
          <div className="py-1">
            <MenuItem icon={<User size={15} />} label="个人资料" onClick={() => handleMenuItem("profile")} />
            <MenuItem icon={<Clock size={15} />} label="历史记录" onClick={() => handleMenuItem("history")} />
            <MenuItem icon={<Shield size={15} />} label="账号信息" onClick={() => handleMenuItem("account")} />
          </div>

          {/* 分割线 + 退出 */}
          <div className="border-t border-white/[0.06] py-1">
            <button
              type="button"
              onClick={handleSignOut}
              className="flex items-center gap-3 w-full h-10 px-4 text-[13px] text-[#ef4444] hover:bg-white/[0.04] transition-colors"
            >
              <LogOut size={15} />
              <span>退出登录</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 单个菜单项 */
function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 w-full h-10 px-4 text-[13px] text-white/70 hover:bg-white/[0.06] hover:text-white/90 transition-colors"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
