"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, X } from "lucide-react";
import { sendVerificationCode, setPassword, ApiError } from "@/lib/auth";
import { useAuth } from "./AuthContext";
import { maskPhone } from "./phoneUtils";

interface AccountInfoModalProps {
  onClose: () => void;
  onOpenRebind: () => void;
}

export function AccountInfoModal({ onClose, onOpenRebind }: AccountInfoModalProps) {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [showSetPassword, setShowSetPassword] = useState(false);
  const [passwordCode, setPasswordCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [pwCountdown, setPwCountdown] = useState(0);
  const [pwSending, setPwSending] = useState(false);
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);
  const pwTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 密码表单倒计时
  useEffect(() => {
    if (pwCountdown <= 0) {
      if (pwTimerRef.current) { clearTimeout(pwTimerRef.current); pwTimerRef.current = null; }
      return;
    }
    pwTimerRef.current = setTimeout(() => setPwCountdown((c) => c - 1), 1000);
    return () => { if (pwTimerRef.current) { clearTimeout(pwTimerRef.current); pwTimerRef.current = null; } };
  }, [pwCountdown]);

  if (!user) return null;

  const handleCopyUid = async () => {
    try {
      await navigator.clipboard.writeText(user.uid);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  // ===== 发送设密码验证码 =====
  const handleSendPwCode = async () => {
    setPwSending(true);
    setPwError(null);
    try {
      await sendVerificationCode(user.phone);
      setPwCountdown(60);
    } catch (e) {
      setPwError(e instanceof ApiError ? e.message : "发送验证码失败");
    } finally {
      setPwSending(false);
    }
  };

  // ===== 提交设密码 =====
  const handleSetPassword = async () => {
    if (newPassword.length < 8) { setPwError("密码至少 8 位"); return; }
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) { setPwError("密码需包含字母和数字"); return; }
    if (newPassword !== confirmPassword) { setPwError("两次密码不一致"); return; }
    if (passwordCode.length !== 6) { setPwError("请输入 6 位验证码"); return; }

    setPwSubmitting(true);
    setPwError(null);
    try {
      await setPassword(passwordCode, newPassword);
      setPwSuccess(true);
      setShowSetPassword(false);
    } catch (e) {
      setPwError(e instanceof ApiError ? e.message : "设置密码失败");
    } finally {
      setPwSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[2147483610] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#1a1a1a] border border-white/[0.12] rounded-xl shadow-[0_24px_80px_rgba(0,0,0,0.5)] w-[420px] max-w-[calc(100vw-32px)] p-10 px-8 relative"
        role="dialog"
        aria-modal="true"
        aria-label="账号信息"
        onClick={(e) => e.stopPropagation()}
      >
        {/* X 按钮 */}
        <button
          type="button"
          className="absolute top-3 right-3 inline-flex w-8 h-8 items-center justify-center rounded-lg text-white/45 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
          aria-label="关闭"
          onClick={onClose}
        >
          <X size={16} />
        </button>

        <h2 className="text-[24px] font-semibold leading-tight mb-6 text-white">账号信息</h2>

        <div className="flex flex-col gap-4">
          {/* 用户 ID */}
          <InfoRow label="用户 ID">
            <span className="text-sm text-white/90 font-mono">{user.uid}</span>
            <button
              type="button"
              onClick={handleCopyUid}
              className="ml-2 text-[11px] text-[#3b82f6] hover:text-[#60a5fa] transition-colors"
            >
              {copied ? "已复制" : "复制"}
            </button>
          </InfoRow>

          {/* 用户名 */}
          <InfoRow label="用户名">
            <span className="text-sm text-white/90">{user.username}</span>
          </InfoRow>

          {/* 手机号 */}
          <InfoRow label="手机号">
            <span className="text-sm text-white/90">{maskPhone(user.phone)}</span>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenRebind();
              }}
              className="ml-2 text-[11px] text-[#3b82f6] hover:text-[#60a5fa] transition-colors"
            >
              换绑
            </button>
          </InfoRow>

          {/* 设置密码 */}
          {!showSetPassword ? (
            <button
              type="button"
              onClick={() => { setShowSetPassword(true); setPwError(null); setPwSuccess(false); }}
              className="w-full h-10 rounded-lg border border-white/[0.08] text-[13px] text-white/55 hover:text-white/80 hover:border-white/15 transition-colors mt-2"
            >
              {user.hasPassword ? "修改密码" : "设置密码"}
            </button>
          ) : (
            <div className="border-t border-white/[0.06] pt-4 mt-2 flex flex-col gap-3">
              <p className="text-[13px] text-white/55">验证码将发送到 {user.phone}</p>

              {/* 验证码 */}
              <div className="flex items-center bg-white/[0.05] rounded-lg px-3 border border-white/[0.06] focus-within:border-white/20 transition-colors">
                <input className="h-10 bg-transparent outline-none text-sm text-white/90 placeholder:text-white/30 w-full"
                  inputMode="numeric" placeholder="短信验证码" value={passwordCode}
                  onChange={(e) => { setPasswordCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setPwError(null); }} />
                <button type="button" disabled={pwCountdown > 0 || pwSending}
                  onClick={handleSendPwCode}
                  className="h-10 shrink-0 inline-flex items-center justify-center text-[13px] font-medium border-l border-white/[0.06] text-white/55 hover:text-white/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed pl-3 ml-3">
                  {pwCountdown > 0 ? `${pwCountdown}s 后重发` : pwSending ? "发送中..." : "获取验证码"}
                </button>
              </div>

              {/* 新密码 */}
              <div className="flex items-center bg-white/[0.05] rounded-lg px-3 border border-white/[0.06] focus-within:border-white/20 transition-colors">
                <input className="h-10 bg-transparent outline-none text-sm text-white/90 placeholder:text-white/30 w-full"
                  type={showPw ? "text" : "password"} placeholder="新密码（8位以上，含字母+数字）" value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); setPwError(null); }} />
                <button type="button" className="shrink-0 text-white/40 hover:text-white/70 transition-colors ml-2"
                  onClick={() => setShowPw((v) => !v)} tabIndex={-1}>
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {/* 确认密码 */}
              <div className="flex items-center bg-white/[0.05] rounded-lg px-3 border border-white/[0.06] focus-within:border-white/20 transition-colors">
                <input className="h-10 bg-transparent outline-none text-sm text-white/90 placeholder:text-white/30 w-full"
                  type={showConfirmPw ? "text" : "password"} placeholder="确认密码" value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setPwError(null); }} />
                <button type="button" className="shrink-0 text-white/40 hover:text-white/70 transition-colors ml-2"
                  onClick={() => setShowConfirmPw((v) => !v)} tabIndex={-1}>
                  {showConfirmPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {/* 错误 / 成功 */}
              {pwError && <p className="text-[12px] text-[#ef4444]">{pwError}</p>}
              {pwSuccess && <p className="text-[12px] text-[#22c55e]">密码设置成功</p>}

              {/* 操作按钮 */}
              <div className="flex gap-2">
                <button type="button"
                  onClick={() => { setShowSetPassword(false); setPwError(null); }}
                  className="flex-1 h-10 rounded-lg border border-white/[0.08] text-[13px] text-white/55 hover:text-white/80 transition-colors">
                  取消
                </button>
                <button type="button" disabled={pwSubmitting}
                  onClick={handleSetPassword}
                  className="flex-1 h-10 rounded-lg bg-[#4e40f3] text-white text-[13px] font-medium transition-colors disabled:opacity-40 enabled:hover:bg-[#3d33d1]">
                  {pwSubmitting ? "提交中..." : "确认设置"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 信息行：标签 + 值 */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-white/[0.04] last:border-b-0">
      <span className="text-[13px] text-white/55">{label}</span>
      <div className="flex items-center">{children}</div>
    </div>
  );
}
