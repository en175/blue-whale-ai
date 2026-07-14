"use client";
/**
 * UserMenu —— 登录入口 / 已登录用户下拉菜单（首页 + 画布 TopBar 共用）。
 *
 * - 未登录：渲染「登录」按钮 → openLogin。
 * - 已登录：渲染头像+用户名+下拉箭头 → 下拉面板（个人资料/历史记录/账号信息/退出）。
 * className 透传到外层，调用方控制定位（首页 fixed 右上 / 画布 TopBar flex 内）。
 */
import { useState } from "react";
import { useAuth } from "./AuthContext";
import { UserMenuDropdown, type ModalName } from "./UserMenuDropdown";
import { ProfileModal } from "./ProfileModal";
import { HistoryModal } from "./HistoryModal";
import { AccountInfoModal } from "./AccountInfoModal";
import { RebindPhoneModal } from "./RebindPhoneModal";

export function UserMenu({ className = "" }: { className?: string }) {
  const { user, openLogin, signOut } = useAuth();
  const [activeModal, setActiveModal] = useState<ModalName | null>(null);

  const closeModal = () => setActiveModal(null);

  if (user) {
    return (
      <>
        <div className={`flex items-center gap-2 ${className}`}>
          <UserMenuDropdown
            user={user}
            onOpenModal={setActiveModal}
            onSignOut={signOut}
          />
        </div>

        {activeModal === "profile" && <ProfileModal onClose={closeModal} />}
        {activeModal === "history" && <HistoryModal onClose={closeModal} />}
        {activeModal === "account" && (
          <AccountInfoModal
            onClose={closeModal}
            onOpenRebind={() => setActiveModal("rebindPhone")}
          />
        )}
        {activeModal === "rebindPhone" && <RebindPhoneModal onClose={closeModal} />}
      </>
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
