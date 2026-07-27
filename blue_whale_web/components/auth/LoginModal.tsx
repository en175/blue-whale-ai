"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { ApiError } from "@/lib/auth";
import { useAuth } from "./AuthContext";

interface LoginModalProps {
  onClose: () => void;
}

export function LoginModal({ onClose }: LoginModalProps) {
  const { signIn } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loginDisabled = !username.trim() || !password || !agreed || loading;

  // ===== 登录 =====
  const handleLogin = async () => {
    if (loginDisabled) return;
    setLoading(true);
    setLoginError(null);

    try {
      await signIn(username.trim(), password);
      // signIn 成功后自动关 modal + 回放 gating action
    } catch (e) {
      setLoginError(e instanceof ApiError ? e.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="tc-login-modal-backdrop fixed inset-0 z-[2147483610] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#141414] border border-white/[0.12] rounded-xl shadow-[0_24px_80px_rgba(0,0,0,0.5)] w-[420px] max-w-[calc(100vw-32px)] p-10 px-8 relative"
        role="dialog"
        aria-modal="true"
        aria-label="登录"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute top-3 right-3 inline-flex w-8 h-8 items-center justify-center rounded-lg text-white/45 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
          aria-label="关闭登录"
          onClick={onClose}
        >
          <X size={16} />
        </button>

        <h2 className="text-[24px] font-semibold leading-tight mb-6 text-white">
          登录
        </h2>

        <div className="flex flex-col gap-3">
          {/* new-api 用户名 */}
          <div>
            <input
              className="h-10 w-full bg-white/[0.05] rounded-lg px-3 border border-white/[0.06] focus-within:border-white/20 outline-none text-sm text-white/90 placeholder:text-white/30"
              placeholder="用户名"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setLoginError(null);
              }}
              autoFocus
            />
            {loginError && (
              <p className="mt-1 text-[12px] text-[#ef4444]">{loginError}</p>
            )}
          </div>

          {/* new-api 密码 */}
          <input
            type="password"
            className="h-10 w-full bg-white/[0.05] rounded-lg px-3 border border-white/[0.06] focus-within:border-white/20 outline-none text-sm text-white/90 placeholder:text-white/30"
            placeholder="密码"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setLoginError(null);
            }}
          />

          {/* 协议 */}
          <label className="flex items-start gap-2 text-[12px] text-white/55 leading-relaxed mt-1 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 accent-[#4e40f3]"
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

          {/* 登录 */}
          <button
            type="button"
            disabled={loginDisabled}
            onClick={handleLogin}
            className="h-11 w-full rounded-lg bg-[#4e40f3] text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:bg-[#3d33d1] mt-2"
          >
            {loading ? "登录中..." : "登录"}
          </button>
        </div>
      </div>
    </div>
  );
}
