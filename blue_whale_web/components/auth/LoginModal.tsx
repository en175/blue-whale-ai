"use client";
/**
 * LoginModal —— 手机号登录弹窗。
 *
 * 外壳复刻 topview.ai modal（深色卡 / 420px / 12px 圆角 / 居中 / 右上 X），
 * 内容换手机号流程：+86 手机号 → 获取验证码（60s 倒计时）→ 验证码（写死 1234）
 * → 协议勾选（未勾禁用登录）→ 紫色登录按钮（DESIGN.md login-primary 豁免）。
 *
 * 仅在 open 时由 AuthContext 条件 mount，故 state 自然为初值，无需关闭重置 effect。
 * modal 范式抄 SkillPanel；z 抬到 2147483610（盖过画布层 2147483600+）。
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  LOGIN_CODE,
  isValidCode,
  isValidPhone,
  sanitizePhone,
} from "./phoneValidation";

interface LoginModalProps {
  onClose: () => void;
  onSuccess: (phone: string) => void;
}

export function LoginModal({ onClose, onSuccess }: LoginModalProps) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ESC 关闭（mount 即监听，卸载即清——组件仅在 open 时 mount）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 倒计时：用 setTimeout 递归替代 setInterval，避免每秒清理/重建 interval
  useEffect(() => {
    if (countdown <= 0) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    timerRef.current = setTimeout(() => {
      setCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [countdown]);

  const phoneValid = isValidPhone(phone);
  const loginDisabled = !phoneValid || code !== LOGIN_CODE || !agreed;
  const sendDisabled = !phoneValid || countdown > 0;

  const handleSendCode = () => {
    if (!phoneValid) {
      setPhoneError("请输入正确的手机号");
      return;
    }
    setPhoneError(null);
    setCountdown(60);
    // L1 mock：验证码 = LOGIN_CODE ("1234")，不真发短信
  };

  const handlePhoneChange = (raw: string) => {
    setPhone(sanitizePhone(raw));
    if (phoneError) setPhoneError(null);
  };

  const handleCodeChange = (raw: string) => {
    const clean = raw.replace(/\D/g, "").slice(0, 4);
    setCode(clean);
    if (clean.length === 4 && !isValidCode(clean)) {
      setCodeError("验证码错误");
    } else if (codeError) {
      setCodeError(null);
    }
  };

  return (
    <div
      className="tc-login-modal-backdrop fixed inset-0 z-[2147483610] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 motion-reduce:animate-none"
      onClick={onClose}
    >
      <div
        className="bg-[var(--tc-login-modal-bg)] border border-white/[0.12] rounded-xl shadow-[var(--tc-modal-shadow)] w-[420px] max-w-[calc(100vw-32px)] p-10 px-8 relative animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none"
        role="dialog"
        aria-modal="true"
        aria-label="登录"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute top-3 right-3 inline-flex w-8 h-8 items-center justify-center rounded-lg text-white/45 hover:text-white/80 hover:bg-white/[0.06] transition-colors duration-150"
          aria-label="关闭登录"
          onClick={onClose}
        >
          <X size={16} />
        </button>

        <h2 className="text-[24px] font-semibold leading-tight mb-6 text-white">
          登录
        </h2>

        <div className="flex flex-col gap-3">
          {/* 手机号 */}
          <div>
            <div className="flex items-center bg-white/[0.05] rounded-lg px-3 border border-white/[0.06] focus-within:border-white/20 transition-colors">
              <span className="inline-flex items-center text-sm text-white/55 border-r border-white/[0.06] pr-2 mr-1 select-none">
                +86
              </span>
              <input
                className="h-10 bg-transparent outline-none text-sm text-white/90 placeholder:text-white/30 w-full"
                inputMode="numeric"
                placeholder="请输入手机号"
                value={phone}
                onChange={(e) => handlePhoneChange(e.target.value)}
                autoFocus
              />
            </div>
            {phoneError && (
              <p className="mt-1 text-[12px] text-[var(--tc-destructive)]">
                {phoneError}
              </p>
            )}
          </div>

          {/* 验证码 */}
          <div>
            <div className="flex items-center bg-white/[0.05] rounded-lg px-3 border border-white/[0.06] focus-within:border-white/20 transition-colors">
              <input
                className="h-10 bg-transparent outline-none text-sm text-white/90 placeholder:text-white/30 w-full tracking-[0.3em]"
                inputMode="numeric"
                placeholder="验证码"
                value={code}
                onChange={(e) => handleCodeChange(e.target.value)}
              />
            </div>
            {codeError && (
              <p className="mt-1 text-[12px] text-[var(--tc-destructive)]">
                {codeError}
              </p>
            )}
          </div>

          {/* 获取验证码 */}
          <button
            type="button"
            disabled={sendDisabled}
            onClick={handleSendCode}
            className="h-10 inline-flex items-center justify-center rounded-lg text-[13px] font-medium border border-white/[0.08] text-white/70 hover:bg-white/[0.05] hover:text-white/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {countdown > 0 ? `${countdown}s 后重发` : "获取验证码"}
          </button>

          {/* 协议勾选 */}
          {/* TODO: 协议链接当前为 mock 占位（href="#" + preventDefault），接真实法务链路后替换 */}
          <label className="flex items-start gap-2 text-[12px] text-white/55 leading-relaxed mt-1 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 accent-[var(--tc-login-primary)]"
            />
            <span>
              我已阅读并同意
              <a
                href="#"
                className="text-white/80 hover:text-white underline mx-0.5"
                onClick={(e) => e.preventDefault()}
              >
                《用户协议》
              </a>
              和
              <a
                href="#"
                className="text-white/80 hover:text-white underline mx-0.5"
                onClick={(e) => e.preventDefault()}
              >
                《隐私政策》
              </a>
            </span>
          </label>

          {/* 登录按钮（紫色 login-primary，DESIGN.md 豁免） */}
          <button
            type="button"
            disabled={loginDisabled}
            onClick={() => !loginDisabled && onSuccess(phone)}
            className="h-11 w-full rounded-lg bg-[var(--tc-login-primary)] text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:bg-[var(--tc-login-primary-hover)] mt-2"
          >
            登录
          </button>
        </div>
      </div>
    </div>
  );
}
