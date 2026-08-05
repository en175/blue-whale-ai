"use client";
/**
 * UserMenu —— 登录入口 / 已登录用户菜单（首页 + 画布 TopBar 共用）。
 *
 * - 未登录：渲染「登录」按钮 → openLogin。
 * - 已登录：外露圆形头像（昵称首字）+ 昵称 + 展开箭头。点头像/昵称区整体展开下拉，
 *   下拉项：个人资料 / 历史记录 / 账号信息 + 底部退出登录。点击选项 / ESC / 点外部
 *   三者都关闭下拉。下拉项打开各自 modal（无新路由）。
 * - className 透传到外层，调用方控制定位（首页 fixed 右上 / 画布 TopBar flex 内）。
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  LogOut,
  History,
  User as UserIcon,
  IdCard,
  Coins,
  Settings,
} from "lucide-react";
import { useAuth } from "./AuthContext";
import { maskPhone } from "./format";
import { ProfileModal } from "./ProfileModal";
import { HistoryModal } from "./HistoryModal";
import { AccountModal } from "./AccountModal";
import { RechargeModal } from "@/components/recharge";

type ActiveModal = "profile" | "history" | "account" | "recharge" | null;

export function UserMenu({ className = "" }: { className?: string }) {
  const { user, openLogin, signOut } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  // ESC 关闭下拉（modal 各自管自己的 ESC）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // 点外部关闭下拉
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!triggerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [open]);

  if (!user) {
    return (
      <button
        type="button"
        onClick={openLogin}
        className={`inline-flex items-center h-9 px-3 rounded-[18px] text-[13px] font-medium text-white/85 border border-white/[0.08] hover:bg-white/[0.05] hover:text-white transition-colors ${className}`}
      >
        登录
      </button>
    );
  }

  const initial = user.username[0] ?? "?";

  const selectItem = (modal: Exclude<ActiveModal, null>) => {
    setOpen(false);
    setActiveModal(modal);
  };

  const handleSignOut = () => {
    setOpen(false);
    signOut();
  };

  return (
    <div className={`relative ${className}`} ref={triggerRef}>
      {/* 触发区：头像 + 昵称 + 箭头 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-2 h-9 pl-1 pr-2.5 rounded-[18px] text-[13px] text-white/85 bg-white/[0.06] border border-white/[0.08] hover:bg-white/[0.1] transition-colors select-none"
      >
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white/[0.1] border border-white/[0.1] text-white text-[12px] font-semibold">
          {initial}
        </span>
        <span className="max-w-[120px] truncate">{user.username}</span>
        <ChevronDown
          size={14}
          className={`text-white/50 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* 下拉菜单 */}
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] w-[240px] rounded-xl bg-[var(--tc-login-modal-bg)] border border-white/[0.12] shadow-[var(--tc-dropdown-shadow)] p-1.5 z-[2147483611] animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none"
        >
          {/* 顶部：头像 + 昵称 + 手机（脱敏） */}
          <div className="flex items-center gap-3 px-2.5 py-2 mb-1">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-white/[0.1] border border-white/[0.1] text-white text-[14px] font-semibold shrink-0">
              {initial}
            </span>
            <div className="min-w-0">
              <div className="text-[13px] text-white/90 truncate">
                {user.username}
              </div>
              <div className="text-[12px] text-white/40 tabular-nums truncate">
                {maskPhone(user.phone)}
              </div>
            </div>
          </div>

          {/* 余额行 */}
          <div className="flex items-center gap-2 px-2.5 py-2 mb-1 rounded-lg bg-white/[0.03] border border-white/[0.05]">
            <Coins
              size={14}
              className="text-[var(--tc-accent,#3b82f6)] shrink-0"
            />
            <span className="text-[12px] text-white/50">积分余额</span>
            <span className="text-[13px] text-white/85 font-medium tabular-nums ml-auto">
              {user.credits ?? "—"}
            </span>
          </div>

          <div className="h-px bg-white/[0.08] my-1" />

          <MenuItem
            icon={<UserIcon size={15} />}
            label="个人资料"
            onClick={() => selectItem("profile")}
          />
          <MenuItem
            icon={<History size={15} />}
            label="历史记录"
            onClick={() => selectItem("history")}
          />
          <MenuItem
            icon={<IdCard size={15} />}
            label="账号信息"
            onClick={() => selectItem("account")}
          />
          <MenuItem
            icon={<Coins size={15} />}
            label="积分充值"
            onClick={() => selectItem("recharge")}
          />

          {/* IK6JXJ：仅管理员可见「系统设置」，点击进入管理后台 */}
          {user.isAdmin && (
            <MenuItem
              icon={<Settings size={15} />}
              label="系统设置"
              onClick={() => {
                setOpen(false);
                router.push("/admin");
              }}
            />
          )}

          <div className="h-px bg-white/[0.08] my-1" />

          <MenuItem
            icon={<LogOut size={15} />}
            label="退出登录"
            onClick={handleSignOut}
            danger
          />
        </div>
      )}

      {/* modals（由 activeModal 控制，全局唯一同时只开一个） */}
      {activeModal === "profile" && (
        <ProfileModal onClose={() => setActiveModal(null)} />
      )}
      {activeModal === "history" && (
        <HistoryModal onClose={() => setActiveModal(null)} />
      )}
      {activeModal === "account" && (
        <AccountModal onClose={() => setActiveModal(null)} />
      )}
      {activeModal === "recharge" && (
        <RechargeModal onClose={() => setActiveModal(null)} />
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`w-full inline-flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-[13px] transition-colors ${
        danger
          ? "text-white/70 hover:text-[var(--tc-destructive)] hover:bg-white/[0.04]"
          : "text-white/80 hover:text-white hover:bg-white/[0.06]"
      }`}
    >
      <span className={danger ? "text-white/50" : "text-white/55"}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}
