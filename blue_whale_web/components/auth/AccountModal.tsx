"use client";
/**
 * AccountModal —— 账号信息弹窗（只读 + 换绑入口）。
 *
 * 内容：userId + 昵称 + 手机号（脱敏），全部只读。手机号行右侧带「换绑」按钮，
 * 打开 RebindPhoneModal。SKIP_AUTH 模式下换绑按钮禁用。
 */
import { useState, type ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { SKIP_AUTH } from "./authStorage";
import { maskPhone } from "./format";
import { ModalShell } from "./ModalShell";
import { RebindPhoneModal } from "./RebindPhoneModal";
import { ChangePasswordModal } from "./ChangePasswordModal";
import { RechargeModal } from "@/components/recharge";
import { AccountRecordsModal } from "@/components/account-records/AccountRecordsModal";

interface AccountModalProps {
  onClose: () => void;
}

function Row({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/[0.06] last:border-0">
      <span className="text-[13px] text-white/45">{label}</span>
      <span className="flex items-center gap-2 ml-4">
        <span className="text-[13px] text-white/85 tabular-nums select-text break-all text-right">
          {value}
        </span>
        {action}
      </span>
    </div>
  );
}

export function AccountModal({ onClose }: AccountModalProps) {
  const { user } = useAuth();
  const [rebindOpen, setRebindOpen] = useState(false);
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);

  const maskedPhone = user ? maskPhone(user.phone) : "";
  const hasNestedModal =
    rebindOpen || changePwdOpen || rechargeOpen || recordsOpen;

  return (
    <ModalShell
      ariaLabel="账号信息"
      onClose={onClose}
      closeOnEscape={!hasNestedModal}
    >
      <h2 className="text-[24px] font-semibold leading-tight mb-6 text-white">
        账号信息
      </h2>

      <div className="flex flex-col">
        <Row label="用户ID" value={user ? String(user.userId) : "—"} />
        <Row label="昵称" value={user?.username ?? "—"} />
        <Row
          label="手机号"
          value={maskedPhone || "—"}
          action={
            <button
              type="button"
              onClick={() => setRebindOpen(true)}
              disabled={SKIP_AUTH}
              className="text-[12px] text-white/55 hover:text-white/90 underline-offset-4 hover:underline transition-colors disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
              title={SKIP_AUTH ? "本地开发模式不可用" : undefined}
            >
              换绑
            </button>
          }
        />
        <Row
          label="密码"
          value={user?.hasPassword ? "已设置" : "未设置"}
          action={
            <button
              type="button"
              onClick={() => setChangePwdOpen(true)}
              disabled={SKIP_AUTH}
              className="text-[12px] text-white/55 hover:text-white/90 underline-offset-4 hover:underline transition-colors disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
              title={SKIP_AUTH ? "本地开发模式不可用" : undefined}
            >
              {user?.hasPassword ? "修改" : "设置"}
            </button>
          }
        />
        <Row
          label="积分余额"
          value={user?.credits != null ? String(user.credits) : "—"}
          action={
            <>
              <button
                type="button"
                onClick={() => setRechargeOpen(true)}
                className="text-[12px] text-[var(--tc-accent,#3b82f6)] hover:opacity-80 underline-offset-4 hover:underline transition-colors"
              >
                去充值
              </button>
              <button
                type="button"
                onClick={() => setRecordsOpen(true)}
                className="text-[12px] text-white/55 hover:text-white/90 underline-offset-4 hover:underline transition-colors"
              >
                账户记录
              </button>
            </>
          }
        />
      </div>

      {SKIP_AUTH && (
        <p className="mt-4 text-[12px] text-white/40 bg-white/[0.03] rounded-lg px-3 py-2 border border-white/[0.06]">
          本地开发模式（SKIP_AUTH）下无法换绑手机号
        </p>
      )}

      {rebindOpen && <RebindPhoneModal onClose={() => setRebindOpen(false)} />}
      {changePwdOpen && (
        <ChangePasswordModal onClose={() => setChangePwdOpen(false)} />
      )}
      {rechargeOpen && <RechargeModal onClose={() => setRechargeOpen(false)} />}
      {recordsOpen && (
        <AccountRecordsModal onClose={() => setRecordsOpen(false)} />
      )}
    </ModalShell>
  );
}
