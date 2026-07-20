"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, X } from "lucide-react";
import { isValidPhone, sanitizePhone } from "./phoneValidation";
import { loadLastPhone, saveLastPhone } from "./authStorage";
import { ApiError, sendVerificationCode } from "@/lib/auth";
import { useAuth } from "./AuthContext";

interface LoginModalProps {
  onClose: () => void;
}

export function LoginModal({ onClose }: LoginModalProps) {
  const { signIn, signInWithPassword } = useAuth();
  const [phone, setPhone] = useState(() => loadLastPhone());
  const [code, setCode] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"sms" | "password">("sms");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [noPasswordHint, setNoPasswordHint] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 倒计时
  useEffect(() => {
    if (countdown <= 0) {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      return;
    }
    timerRef.current = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };
  }, [countdown]);

  const phoneValid = isValidPhone(phone);
  const smsLoginDisabled = !phoneValid || code.length !== 6 || !agreed || loading;
  const passwordLoginDisabled = phone.length < 1 || password.length < 1 || loading;
  const loginDisabled = mode === "sms" ? smsLoginDisabled : passwordLoginDisabled;

  // ===== 获取验证码: 直接发送短信 =====
  const handleSendCode = async () => {
    if (!phoneValid) { setPhoneError("请输入正确的手机号"); return; }
    setPhoneError(null);
    setLoading(true);

    try {
      await sendVerificationCode(phone);
      setCountdown(60);
    } catch (e) {
      setPhoneError(e instanceof ApiError ? e.message : "发送验证码失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  // ===== 登录 =====
  const handleLogin = async () => {
    if (loginDisabled) return;
    setLoading(true);
    setCodeError(null);
    setNoPasswordHint(false);

    try {
      if (mode === "password") {
        await signInWithPassword(phone, password);
      } else {
        await signIn(phone, code);
      }
      saveLastPhone(phone);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "登录失败";
      if (mode === "password" && msg.includes("未设置密码")) {
        setNoPasswordHint(true);
      } else {
        setCodeError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneChange = (raw: string) => {
    // 密码模式支持用户名输入，不剥除非数字字符
    setPhone(mode === "sms" ? sanitizePhone(raw) : raw);
    if (phoneError) setPhoneError(null);
  };

  const handleCodeChange = (raw: string) => {
    setCode(raw.replace(/\D/g, "").slice(0, 6));
    if (codeError) setCodeError(null);
  };

  return (
    <div
      className="tc-login-modal-backdrop fixed inset-0 z-[2147483610] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#141414] border border-white/[0.12] rounded-xl shadow-[0_24px_80px_rgba(0,0,0,0.5)] w-[420px] max-w-[calc(100vw-32px)] p-10 px-8 relative"
        role="dialog" aria-modal="true" aria-label="登录"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button"
          className="absolute top-3 right-3 inline-flex w-8 h-8 items-center justify-center rounded-lg text-white/45 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
          aria-label="关闭登录" onClick={onClose}>
          <X size={16} />
        </button>

        <h2 className="text-[24px] font-semibold leading-tight mb-6 text-white">登录</h2>

        {/* Tab 切换 */}
        <div className="flex mb-4 bg-white/[0.04] rounded-lg p-0.5">
          <button type="button"
            className={"flex-1 h-8 rounded-md text-[13px] font-medium transition-colors" + (mode === "sms" ? " bg-white/[0.10] text-white" : " text-white/45 hover:text-white/70")}
            onClick={() => { setMode("sms"); setPhone(sanitizePhone(phone)); setNoPasswordHint(false); setCodeError(null); }}>
            短信登录
          </button>
          <button type="button"
            className={"flex-1 h-8 rounded-md text-[13px] font-medium transition-colors" + (mode === "password" ? " bg-white/[0.10] text-white" : " text-white/45 hover:text-white/70")}
            onClick={() => { setMode("password"); setCodeError(null); }}>
            密码登录
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {/* 手机号/用户名 */}
          <div>
            <div className="flex items-center bg-white/[0.05] rounded-lg px-3 border border-white/[0.06] focus-within:border-white/20 transition-colors">
              {mode === "sms" && <span className="inline-flex items-center text-sm text-white/55 border-r border-white/[0.06] pr-2 mr-1 select-none">+86</span>}
              <input className="h-10 bg-transparent outline-none text-sm text-white/90 placeholder:text-white/30 w-full"
                inputMode={mode === "sms" ? "numeric" : "text"}
                placeholder={mode === "sms" ? "请输入手机号" : "手机号/用户名"}
                value={phone}
                onChange={(e) => handlePhoneChange(e.target.value)} autoFocus />
            </div>
            {phoneError && <p className="mt-1 text-[12px] text-[#ef4444]">{phoneError}</p>}
          </div>

          {/* 短信模式：验证码 */}
          {mode === "sms" && (
            <div>
              <div className="flex items-center bg-white/[0.05] rounded-lg px-3 border border-white/[0.06] focus-within:border-white/20 transition-colors">
                <input className="h-10 bg-transparent outline-none text-sm text-white/90 placeholder:text-white/30 w-full"
                  inputMode="numeric" placeholder="短信验证码" value={code}
                  onChange={(e) => handleCodeChange(e.target.value)} />
                <button type="button" disabled={!phoneValid || countdown > 0 || loading}
                  onClick={handleSendCode}
                  className="h-10 shrink-0 inline-flex items-center justify-center text-[13px] font-medium border-l border-white/[0.06] text-white/55 hover:text-white/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed pl-3 ml-3">
                  {countdown > 0 ? `${countdown}s 后重发` : "获取验证码"}
                </button>
              </div>
            </div>
          )}

          {/* 密码模式：密码输入 */}
          {mode === "password" && (
            <div>
              <div className="flex items-center bg-white/[0.05] rounded-lg px-3 border border-white/[0.06] focus-within:border-white/20 transition-colors">
                <input className="h-10 bg-transparent outline-none text-sm text-white/90 placeholder:text-white/30 w-full"
                  type={showPassword ? "text" : "password"}
                  placeholder="请输入密码" value={password}
                  onChange={(e) => { setPassword(e.target.value); if (codeError) setCodeError(null); }} />
                <button type="button"
                  className="shrink-0 inline-flex items-center justify-center text-white/40 hover:text-white/70 transition-colors ml-2"
                  onClick={() => setShowPassword((v) => !v)} tabIndex={-1}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          )}

          {/* 错误提示 */}
          {codeError && <p className="text-[12px] text-[#ef4444]">{codeError}</p>}

          {/* 未设置密码提示 */}
          {noPasswordHint && (
            <div className="flex items-center gap-2 text-[12px] text-white/55 bg-white/[0.04] rounded-lg px-3 py-2">
              <span>未设置密码，请先用验证码登录</span>
              <button type="button"
                className="text-[#4e40f3] hover:text-[#3d33d1] font-medium"
                onClick={() => { setMode("sms"); setPhone(sanitizePhone(phone)); setNoPasswordHint(false); }}>
                切换
              </button>
            </div>
          )}

          {/* 协议（仅短信模式） */}
          {mode === "sms" && (
            <label className="flex items-start gap-2 text-[12px] text-white/55 leading-relaxed mt-1 select-none cursor-pointer">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 accent-[#4e40f3]" />
              <span>
                我已阅读并同意
                <a href="#" className="text-white/80 hover:text-white underline mx-0.5" onClick={(e) => e.preventDefault()}>《用户协议》</a>
                和
                <a href="#" className="text-white/80 hover:text-white underline mx-0.5" onClick={(e) => e.preventDefault()}>《隐私政策》</a>
              </span>
            </label>
          )}

          {/* 登录 */}
          <button type="button" disabled={loginDisabled}
            onClick={handleLogin}
            className="h-11 w-full rounded-lg bg-[#4e40f3] text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:bg-[#3d33d1] mt-2">
            {loading ? "登录中..." : "登录"}
          </button>
        </div>
      </div>
    </div>
  );
}
