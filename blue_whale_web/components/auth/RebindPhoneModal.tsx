"use client";
/**
 * RebindPhoneModal —— 换绑手机号弹窗（3 步状态机，适配真实后端 API）。
 *
 * 后端换绑流程：sendChangePhoneCode（对新号发码，需图形验证码）→ changePhone（校验码 + 查重）。
 * 后端无"验证旧号"接口，故 step1 为"确认身份"提示步（显示当前号，告知风险，不造前端验证）。
 *
 * 步骤：
 *   1. confirm-identity：显示当前手机号（脱敏）+ 安全提示 +「下一步」
 *   2. input-new：输入新手机号 → 获取验证码（fetchCaptcha 图形码 → sendChangePhoneCode 短信码，60s 倒计时）
 *                → 填 6 位短信码 →「下一步」。占用检测在后端：sendChangePhoneCode 报错显示后端 message。
 *   3. confirm：展示「当前号 → 新号」对比 → changePhone → 成功态 → 自动关闭
 *
 * 失败处理：换绑失败时清空 smsCode/captchaAnswer/captchaToken，避免被拒/过期旧码残留（S1）。
 * SKIP_AUTH 模式下：所有操作禁用 + 提示（整个 modal 不可交互，由 AccountModal 的换绑按钮已禁用兜底）。
 */
import { useEffect, useRef, useState } from "react";
import {
  fetchCaptcha,
  sendChangePhoneCode,
  changePhone,
} from "@/lib/auth";
import { useAuth } from "./AuthContext";
import { SKIP_AUTH } from "./authStorage";
import { getErrorMessage, maskPhone } from "./format";
import { ModalShell } from "./ModalShell";
import { isValidPhone, sanitizePhone } from "./phoneValidation";

type Step = "confirm-identity" | "input-new" | "confirm" | "done";

interface RebindPhoneModalProps {
  onClose: () => void;
}

const STEP_TITLE: Record<Step, string> = {
  "confirm-identity": "换绑手机号",
  "input-new": "换绑手机号",
  confirm: "确认换绑",
  done: "换绑成功",
};

export function RebindPhoneModal({ onClose }: RebindPhoneModalProps) {
  const { user, refreshUser } = useAuth();

  const [step, setStep] = useState<Step>("confirm-identity");
  const [newPhone, setNewPhone] = useState("");
  const [newPhoneError, setNewPhoneError] = useState<string | null>(null);
  const [smsCode, setSmsCode] = useState("");
  const [smsCodeError, setSmsCodeError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(false);

  // 图形验证码
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaImage, setCaptchaImage] = useState<string | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [showCaptcha, setShowCaptcha] = useState(false);
  const [captchaError, setCaptchaError] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // S2: done 步自动关闭的 timer，unmount 时清理（和 countdown timer 同范式）
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 短信码倒计时（setTimeout 递归，抄 LoginModal）
  useEffect(() => {
    if (countdown <= 0) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    timerRef.current = setTimeout(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [countdown]);

  // 卸载清双 timer（防御）：countdown + done 自动关闭
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    };
  }, []);

  if (!user) return null;
  const oldPhone = user.phone;

  const newPhoneValid = isValidPhone(newPhone);
  const smsCodeValid = smsCode.length === 6;
  const sendDisabled = !newPhoneValid || countdown > 0 || loading;
  const nextDisabled = !newPhoneValid || !smsCodeValid;

  // ===== step2：获取验证码（图形验证码叠加层）=====
  const handleSendCode = async () => {
    if (!newPhoneValid) {
      setNewPhoneError("请输入正确的手机号");
      return;
    }
    setNewPhoneError(null);
    setLoading(true);
    try {
      const captcha = await fetchCaptcha();
      setCaptchaToken(captcha.captcha_token);
      setCaptchaImage(captcha.captcha_image);
      setCaptchaAnswer("");
      setCaptchaError(null);
      setShowCaptcha(true);
    } catch (e) {
      setNewPhoneError(getErrorMessage(e, "获取验证码失败"));
    } finally {
      setLoading(false);
    }
  };

  // 提交图形验证码 → 发短信
  const handleCaptchaSubmit = async () => {
    if (!captchaAnswer || !captchaToken || !newPhoneValid) return;
    setLoading(true);
    setCaptchaError(null);
    try {
      await sendChangePhoneCode(newPhone, captchaToken, captchaAnswer);
      setShowCaptcha(false);
      setCountdown(60);
    } catch (e) {
      setCaptchaError(getErrorMessage(e, "验证失败，请重试"));
      // 刷新图形验证码
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

  const handleNewPhoneChange = (raw: string) => {
    setNewPhone(sanitizePhone(raw));
    if (newPhoneError) setNewPhoneError(null);
  };

  const handleSmsCodeChange = (raw: string) => {
    setSmsCode(raw.replace(/\D/g, "").slice(0, 6));
    if (smsCodeError) setSmsCodeError(null);
  };

  // step2 → step3
  const handleNextToConfirm = () => {
    if (newPhone === oldPhone) {
      setNewPhoneError("新手机号与当前一致");
      return;
    }
    if (!newPhoneValid) {
      setNewPhoneError("请输入正确的手机号");
      return;
    }
    if (!smsCodeValid) {
      setSmsCodeError("请输入 6 位验证码");
      return;
    }
    setStep("confirm");
  };

  // step3：确认换绑
  const handleConfirm = async () => {
    setLoading(true);
    setSmsCodeError(null);
    try {
      await changePhone(newPhone, smsCode);
      // 成功：同步本地用户信息（手机号已变）
      await refreshUser();
      setStep("done");
      doneTimerRef.current = setTimeout(onClose, 1200);
    } catch (e) {
      // S1: 失败时清空验证码字段，避免被拒/过期旧码残留，用户需重新走图形码→短信码
      const msg = getErrorMessage(e, "换绑失败");
      setSmsCodeError(msg);
      setSmsCode("");
      setCaptchaAnswer("");
      setCaptchaToken(null);
      setShowCaptcha(false);
      setStep("input-new");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell ariaLabel="换绑手机号" onClose={onClose} zIndex={2147483612}>
      <div className="flex items-baseline justify-between mb-6">
        <h2 className="text-[24px] font-semibold leading-tight text-white">
          {STEP_TITLE[step]}
        </h2>
        {step !== "done" && (
          <span className="text-[12px] text-white/40 tabular-nums">
            步骤 {step === "confirm-identity" ? 1 : step === "input-new" ? 2 : 3} / 3
          </span>
        )}
      </div>

      {SKIP_AUTH && step !== "done" && (
        <p className="mb-4 text-[12px] text-white/40 bg-white/[0.03] rounded-lg px-3 py-2 border border-white/[0.06]">
          本地开发模式（SKIP_AUTH）下无法换绑手机号
        </p>
      )}

      {/* step1：确认身份 */}
      {step === "confirm-identity" && (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-white/55 leading-relaxed">
            为保障账号安全，换绑前请确认当前身份。换绑后原手机号将不再绑定本账号，新手机号将成为登录凭证。
          </p>
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-4">
            <div className="text-[11px] text-white/40 mb-1">当前绑定手机号</div>
            <div className="text-[16px] text-white/90 tabular-nums">{maskPhone(oldPhone)}</div>
          </div>
          <button
            type="button"
            onClick={() => setStep("input-new")}
            disabled={SKIP_AUTH}
            className="h-10 rounded-lg text-[14px] font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-[var(--tc-accent)] hover:brightness-110"
          >
            下一步
          </button>
        </div>
      )}

      {/* step2：输入新号 + 验证码 */}
      {step === "input-new" && (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-white/55 leading-relaxed">
            请输入要绑定的新手机号并完成验证。
          </p>
          {/* 新手机号 */}
          <div>
            <label className="block text-[13px] text-white/55 mb-1.5">新手机号</label>
            <div className="flex items-center bg-white/[0.05] rounded-lg px-3 border border-white/[0.06] focus-within:border-white/20 transition-colors">
              <span className="inline-flex items-center text-sm text-white/55 border-r border-white/[0.06] pr-2 mr-1 select-none">
                +86
              </span>
              <input
                className="h-10 bg-transparent outline-none text-sm text-white/90 placeholder:text-white/30 w-full"
                inputMode="numeric"
                placeholder="请输入新手机号"
                value={newPhone}
                onChange={(e) => handleNewPhoneChange(e.target.value)}
                autoFocus
              />
            </div>
            {newPhoneError && (
              <p className="mt-1 text-[12px] text-[var(--tc-destructive)]">{newPhoneError}</p>
            )}
          </div>
          {/* 短信验证码 */}
          <div>
            <label className="block text-[13px] text-white/55 mb-1.5">短信验证码</label>
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
                {countdown > 0 ? `${countdown}s 后重发` : loading ? "获取中…" : "获取验证码"}
              </button>
            </div>
            {smsCodeError && (
              <p className="mt-1 text-[12px] text-[var(--tc-destructive)]">{smsCodeError}</p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep("confirm-identity")}
              className="h-10 px-4 rounded-lg text-[14px] text-white/70 border border-white/[0.08] hover:bg-white/[0.05] transition-colors"
            >
              上一步
            </button>
            <button
              type="button"
              disabled={nextDisabled || SKIP_AUTH}
              onClick={handleNextToConfirm}
              className="flex-1 h-10 rounded-lg text-[14px] font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-[var(--tc-accent)] hover:brightness-110"
            >
              下一步
            </button>
          </div>
        </div>
      )}

      {/* step3：确认换绑 */}
      {step === "confirm" && (
        <div className="flex flex-col gap-5">
          <p className="text-[13px] text-white/55 leading-relaxed">
            请确认换绑后的手机号，此操作将改变账号绑定的手机号。
          </p>
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-4 flex items-center justify-center gap-3">
            <div className="text-center">
              <div className="text-[11px] text-white/40 mb-1">当前</div>
              <div className="text-[15px] text-white/70 tabular-nums">{maskPhone(oldPhone)}</div>
            </div>
            <span className="text-white/40 text-lg">→</span>
            <div className="text-center">
              <div className="text-[11px] text-white/40 mb-1">换绑为</div>
              <div className="text-[15px] text-white font-medium tabular-nums">
                {maskPhone(newPhone)}
              </div>
            </div>
          </div>
          <p className="text-[12px] text-white/40 leading-relaxed">
            换绑后原手机号将不再绑定本账号，新手机号将成为登录凭证。
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep("input-new")}
              disabled={loading}
              className="h-10 px-4 rounded-lg text-[14px] text-white/70 border border-white/[0.08] hover:bg-white/[0.05] transition-colors disabled:opacity-40"
            >
              上一步
            </button>
            <button
              type="button"
              disabled={loading || SKIP_AUTH}
              onClick={handleConfirm}
              className="flex-1 h-10 rounded-lg text-[14px] font-medium text-white transition-colors disabled:opacity-40 bg-[var(--tc-accent)] hover:brightness-110"
            >
              {loading ? "处理中…" : "确认换绑"}
            </button>
          </div>
        </div>
      )}

      {/* done */}
      {step === "done" && (
        <div className="py-6 text-center">
          <div className="text-4xl mb-4">✅</div>
          <p className="text-[15px] text-white/90 mb-1">手机号换绑成功</p>
          <p className="text-[13px] text-white/45 tabular-nums">新绑定：{maskPhone(newPhone)}</p>
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
            <p className="text-[12px] text-[var(--tc-destructive)]">{captchaError}</p>
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
