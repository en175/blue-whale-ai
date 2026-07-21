"use client";
/**
 * ChangePasswordModal —— 设置 / 修改密码弹窗（2 步状态机）。
 *
 * hasPassword=false → 设置密码（setPassword）：成功后 done + 自动关闭，不踢设备。
 * hasPassword=true  → 修改密码（changePassword）：短信码 + 旧密码双重验证，成功后后端踢所有设备，
 *                     前端 signOut + openLogin 强制重新登录。
 *
 * 发码复用 POST /api/auth/send-code（sendVerificationCode，对当前手机号），验证用户持有绑定号。
 * 失败清验证码字段（S1，同 RebindPhoneModal）。SKIP_AUTH 模式按钮禁用 + 横幅。
 */
import { useEffect, useRef, useState } from "react";
import {
  fetchCaptcha,
  sendVerificationCode,
  setPassword,
  changePassword,
} from "@/lib/auth";
import { useAuth } from "./AuthContext";
import { SKIP_AUTH } from "./authStorage";
import { getErrorMessage } from "./format";
import { ModalShell } from "./ModalShell";
import { isValidPassword } from "./passwordValidation";

type Step = "input" | "done";

interface ChangePasswordModalProps {
  onClose: () => void;
}

export function ChangePasswordModal({ onClose }: ChangePasswordModalProps) {
  const { user, signOut, openLogin } = useAuth();
  const hasPassword = !!user?.hasPassword;

  const [step, setStep] = useState<Step>("input");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(false);

  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // 图形验证码
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaImage, setCaptchaImage] = useState<string | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [showCaptcha, setShowCaptcha] = useState(false);
  const [captchaError, setCaptchaError] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 短信码倒计时（setTimeout 递归，同 RebindPhoneModal）
  useEffect(() => {
    if (countdown <= 0) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    timerRef.current = setTimeout(
      () => setCountdown((c) => Math.max(0, c - 1)),
      1000,
    );
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [countdown]);

  // 卸载清双 timer（countdown + done 自动关闭）
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    };
  }, []);

  if (!user) return null;
  const phone = user.phone;
  const smsCodeValid = smsCode.length === 6;
  const sendDisabled = countdown > 0 || loading;

  const handleSendCode = async () => {
    setFormError(null);
    setLoading(true);
    try {
      const captcha = await fetchCaptcha();
      setCaptchaToken(captcha.captcha_token);
      setCaptchaImage(captcha.captcha_image);
      setCaptchaAnswer("");
      setCaptchaError(null);
      setShowCaptcha(true);
    } catch (e) {
      setFormError(getErrorMessage(e, "获取验证码失败"));
    } finally {
      setLoading(false);
    }
  };

  const handleCaptchaSubmit = async () => {
    if (!captchaAnswer || !captchaToken) return;
    setLoading(true);
    setCaptchaError(null);
    try {
      await sendVerificationCode(phone, captchaToken, captchaAnswer);
      setShowCaptcha(false);
      setCountdown(60);
    } catch (e) {
      setCaptchaError(getErrorMessage(e, "验证失败，请重试"));
      try {
        const captcha = await fetchCaptcha();
        setCaptchaToken(captcha.captcha_token);
        setCaptchaImage(captcha.captcha_image);
        setCaptchaAnswer("");
      } catch {
        /* ignore */
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSmsCodeChange = (raw: string) => {
    setSmsCode(raw.replace(/\D/g, "").slice(0, 6));
    if (formError) setFormError(null);
  };

  const validate = (): string | null => {
    if (hasPassword && !oldPassword) return "请输入旧密码";
    if (!isValidPassword(newPassword))
      return "密码需 8-128 位，且包含字母和数字";
    if (confirmPassword !== newPassword) return "两次输入的新密码不一致";
    if (!smsCodeValid) return "请输入 6 位验证码";
    if (hasPassword && newPassword === oldPassword)
      return "新密码不能与旧密码相同";
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) {
      setFormError(err);
      return;
    }
    setLoading(true);
    setFormError(null);
    try {
      if (hasPassword) {
        await changePassword(smsCode, oldPassword, newPassword);
        // 改密成功：后端已踢所有设备。前端登出当前设备 + 弹登录窗。
        signOut();
        openLogin();
        onClose();
      } else {
        await setPassword(smsCode, newPassword);
        setStep("done");
        doneTimerRef.current = setTimeout(onClose, 1200);
      }
    } catch (e) {
      const msg = getErrorMessage(
        e,
        hasPassword ? "修改密码失败" : "设置密码失败",
      );
      setFormError(msg);
      // S1: 失败清验证码字段，避免被拒/过期旧码残留
      setSmsCode("");
      setCaptchaAnswer("");
      setCaptchaToken(null);
      setShowCaptcha(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell
      ariaLabel={hasPassword ? "修改密码" : "设置密码"}
      onClose={onClose}
      zIndex={2147483612}
    >
      <h2 className="text-[24px] font-semibold leading-tight mb-6 text-white">
        {step === "done" ? "设置成功" : hasPassword ? "修改密码" : "设置密码"}
      </h2>

      {SKIP_AUTH && step !== "done" && (
        <p className="mb-4 text-[12px] text-white/40 bg-white/[0.03] rounded-lg px-3 py-2 border border-white/[0.06]">
          本地开发模式（SKIP_AUTH）下无法设置/修改密码
        </p>
      )}

      {step === "input" && (
        <div className="flex flex-col gap-4">
          {hasPassword && (
            <PasswordField
              label="旧密码"
              value={oldPassword}
              onChange={setOldPassword}
              show={showOld}
              onToggle={() => setShowOld((v) => !v)}
              placeholder="请输入旧密码"
            />
          )}
          <PasswordField
            label="新密码"
            value={newPassword}
            onChange={setNewPassword}
            show={showNew}
            onToggle={() => setShowNew((v) => !v)}
            placeholder="8-128 位，含字母和数字"
          />
          <PasswordField
            label="确认新密码"
            value={confirmPassword}
            onChange={setConfirmPassword}
            show={showConfirm}
            onToggle={() => setShowConfirm((v) => !v)}
            placeholder="再次输入新密码"
          />

          {/* 短信验证码 */}
          <div>
            <label className="block text-[13px] text-white/55 mb-1.5">
              短信验证码
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center bg-white/[0.05] rounded-lg px-3 border border-white/[0.06] focus-within:border-white/20 transition-colors">
                <input
                  className="h-10 bg-transparent outline-none text-sm text-white/90 placeholder:text-white/30 w-full tracking-[0.3em]"
                  inputMode="numeric"
                  placeholder="6 位验证码"
                  value={smsCode}
                  onChange={(e) => handleSmsCodeChange(e.target.value)}
                />
              </div>
              <button
                type="button"
                disabled={sendDisabled || SKIP_AUTH}
                onClick={handleSendCode}
                className="h-10 px-3 rounded-lg text-[13px] text-white/85 border border-white/[0.08] hover:bg-white/[0.05] disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              >
                {countdown > 0
                  ? `${countdown}s 后重发`
                  : loading
                    ? "获取中…"
                    : "获取验证码"}
              </button>
            </div>
          </div>

          {formError && (
            <p className="text-[12px] text-[var(--tc-destructive)]">
              {formError}
            </p>
          )}

          <button
            type="button"
            disabled={loading || SKIP_AUTH}
            onClick={handleSubmit}
            className="h-10 rounded-lg text-[14px] font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-[var(--tc-accent)] hover:brightness-110"
          >
            {loading ? "处理中…" : hasPassword ? "确认修改" : "确认设置"}
          </button>
        </div>
      )}

      {step === "done" && (
        <div className="py-6 text-center">
          <div className="text-4xl mb-4">✅</div>
          <p className="text-[15px] text-white/90 mb-1">密码设置成功</p>
          <p className="text-[13px] text-white/45">已为账号添加密码保护</p>
        </div>
      )}

      {/* 图形验证码叠加层 */}
      {showCaptcha && captchaImage && (
        <div
          className="absolute inset-0 z-10 bg-[var(--tc-login-modal-bg)] rounded-xl flex flex-col items-center justify-center gap-3 p-8 animate-in fade-in duration-150"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-[13px] text-white/70">请输入图形验证码</div>
          <img
            src={captchaImage}
            alt="图形验证码"
            className="h-12 rounded border border-white/[0.1]"
          />
          <input
            className="h-10 w-32 text-center bg-white/[0.05] rounded-lg px-3 border border-white/[0.06] focus-within:border-white/20 outline-none text-sm text-white/90 tracking-[0.3em]"
            placeholder="验证码"
            value={captchaAnswer}
            onChange={(e) => setCaptchaAnswer(e.target.value)}
            autoFocus
            maxLength={6}
          />
          {captchaError && (
            <p className="text-[12px] text-[var(--tc-destructive)]">
              {captchaError}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowCaptcha(false)}
              className="h-9 px-3 rounded-lg text-[13px] text-white/70 border border-white/[0.08] hover:bg-white/[0.05] transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              disabled={!captchaAnswer || loading}
              onClick={handleCaptchaSubmit}
              className="h-9 px-4 rounded-lg text-[13px] font-medium text-white bg-[var(--tc-accent)] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "发送中…" : "发送短信"}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

/** 密码输入框（带显隐切换） */
function PasswordField({
  label,
  value,
  onChange,
  show,
  onToggle,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className="block text-[13px] text-white/55 mb-1.5">{label}</label>
      <div className="flex items-center bg-white/[0.05] rounded-lg px-3 border border-white/[0.06] focus-within:border-white/20 transition-colors">
        <input
          type={show ? "text" : "password"}
          className="h-10 bg-transparent outline-none text-sm text-white/90 placeholder:text-white/30 w-full"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={onToggle}
          className="text-[12px] text-white/45 hover:text-white/80 transition-colors px-1 select-none"
        >
          {show ? "隐藏" : "显示"}
        </button>
      </div>
    </div>
  );
}
