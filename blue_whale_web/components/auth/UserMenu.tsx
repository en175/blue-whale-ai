"use client";
/**
 * UserMenu —— 登录入口 / 已登录用户胶囊（首页 + 画布 TopBar 共用）。
 *
 * - 未登录：渲染「登录」按钮 → openLogin。
 * - 已登录：渲染「用户XXXX」胶囊 + 「退出」按钮 → signOut。
 * className 透传到外层，调用方控制定位（首页 fixed 右上 / 画布 TopBar flex 内）。
 */
import { useAuth } from "./AuthContext";

export function UserMenu({ className = "" }: { className?: string }) {
  const { user, openLogin, signOut } = useAuth();

  if (user) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <span className="inline-flex items-center h-9 px-3 rounded-[18px] text-[13px] text-white/85 bg-white/[0.06] border border-white/[0.08] select-none">
          {user.username}
        </span>
        <button
          type="button"
          onClick={signOut}
          className="inline-flex items-center h-9 px-3 rounded-[18px] text-[13px] text-white/70 border border-white/[0.08] hover:text-white/90 hover:bg-white/[0.05] transition-colors"
        >
          退出
        </button>
      </div>
    );
  }

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
