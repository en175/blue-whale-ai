"use client";

import { useEffect, useState } from "react";
import { X, ChevronLeft, Loader2 } from "lucide-react";
import { useAuth } from "./AuthContext";
import { maskPhone } from "./phoneUtils";
import { sendVerificationCode, sendChangePhoneCode, fetchCaptcha } from "@/lib/auth";

type Step = 1 | 2 | 3 | 4;

interface RebindPhoneModalProps {
  onClose: () => void;
}

export function RebindPhoneModal({ onClose }: RebindPhoneModalProps) {
  const { user, changePhone } = useAuth();

  const [step, setStep] = useState<Step>(1);
  const [currentCode, setCurrentCode] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newCode, setNewCode] = useState("");

  // 验证码发送状态
  const [currentCodeSending, setCurrentCodeSending] = useState(false);
  const [currentCodeSent, setCurrentCodeSent] = useState(false);
  const [currentCountdown, setCurrentCountdown] = useState(0);
  const [newCodeSending, setNewCodeSending] = useState(false);
  const [newCodeSent, setNewCodeSent] = useState(false);
  const [newCountdown, setNewCountdown] = useState(0);

  // 图形验证码（非测试号必需）
  const [captchaImage, setCaptchaImage] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // ---- ESC 关闭 ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ---- 倒计时 ----
  useEffect(() => {
    if (currentCountdown <= 0) return;
    const t = setInterval(() => setCurrentCountdown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [currentCountdown]);

  useEffect(() => {
    if (newCountdown <= 0) return;
    const t = setInterval(() => setNewCountdown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [newCountdown]);

  if (!user) return null;

  const isTestPhone = user.phone === "15079999999";

  // ---- 加载图形验证码 ----
  const loadCaptcha = async () => {
    try {
      const result = await fetchCaptcha();
      setCaptchaImage(result.captcha_image);
      setCaptchaToken(result.captcha_token);
      setCaptchaAnswer("");
    } catch {
      setError("获取图形验证码失败");
    }
  };

  // ---- Step 1: 向当前手机号发验证码 ----
  const handleSendCurrentCode = async () => {
    setError(null);
    setCurrentCodeSending(true);
    try {
      if (isTestPhone) {
        // 测试号跳过 captcha
        await sendVerificationCode(user.phone, "", "");
      } else {
        if (!captchaToken) {
          await loadCaptcha();
          setCurrentCodeSending(false);
          return;
        }
        await sendVerificationCode(user.phone, captchaToken, captchaAnswer);
      }
      setCurrentCodeSent(true);
      setCurrentCountdown(60);
      if (!isTestPhone) {
        setCaptchaImage(null);
        setCaptchaToken("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "发送失败");
      if (!isTestPhone) loadCaptcha(); // 刷新验证码
    } finally {
      setCurrentCodeSending(false);
    }
  };

  // ---- Step 3: 向新手机号发验证码 ----
  const handleSendNewCode = async () => {
    setError(null);
    setNewCodeSending(true);
    try {
      if (isTestPhone || newPhone === "15079999999") {
        await sendChangePhoneCode(newPhone, "", "");
      } else {
        if (!captchaToken) {
          await loadCaptcha();
          setNewCodeSending(false);
          return;
        }
        await sendChangePhoneCode(newPhone, captchaToken, captchaAnswer);
      }
      setNewCodeSent(true);
      setNewCountdown(60);
      if (!isTestPhone && newPhone !== "15079999999") {
        setCaptchaImage(null);
        setCaptchaToken("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "发送失败");
      if (!isTestPhone && newPhone !== "15079999999") loadCaptcha();
    } finally {
      setNewCodeSending(false);
    }
  };

  // ---- 下一步校验 ----
  const goNext = () => {
    setError(null);
    if (step === 1) {
      if (!currentCode.trim() || currentCode.trim().length !== 6) {
        setError("请输入 6 位验证码");
        return;
      }
      setStep(2);
    } else if (step === 2) {
      const phone = newPhone.trim();
      if (!/^1[3-9]\d{9}$/.test(phone)) {
        setError("请输入正确的手机号");
        return;
      }
      if (phone === user.phone) {
        setError("新手机号不能与当前手机号相同");
        return;
      }
      setStep(3);
    } else if (step === 3) {
      if (!newCode.trim() || newCode.trim().length !== 6) {
        setError("请输入 6 位验证码");
        return;
      }
      setStep(4);
    }
  };

  // ---- 确认换绑 ----
  const handleConfirm = async () => {
    setError(null);
    setLoading(true);
    try {
      await changePhone(newPhone.trim(), newCode.trim());
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "换绑失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  // ---- 返回上一步 ----
  const goBack = () => {
    setError(null);
    if (step > 1) setStep((s) => (s - 1) as Step);
  };

  // ---- 成功页 ----
  if (done) {
    return (
      <div
        className="fixed inset-0 z-[2147483610] flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className="bg-[#1a1a1a] border border-white/[0.12] rounded-xl shadow-[0_24px_80px_rgba(0,0,0,0.5)] w-[420px] max-w-[calc(100vw-32px)] p-10 px-8 relative text-center"
          role="dialog"
          aria-modal="true"
          aria-label="换绑完成"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-4xl mb-4">✅</div>
          <h2 className="text-xl font-semibold text-white mb-2">手机号更换成功</h2>
          <p className="text-sm text-white/55 mb-6">
            已更换为 {maskPhone(newPhone.trim())}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center h-10 px-6 rounded-lg bg-[#3b82f6] text-white text-sm font-medium hover:bg-[#2563eb] transition-colors"
          >
            完成
          </button>
        </div>
      </div>
    );
  }

  // ---- 步骤标题 ----
  const stepTitles: Record<Step, string> = {
    1: "验证当前手机号",
    2: "输入新手机号",
    3: "验证新手机号",
    4: "确认换绑",
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
        aria-label={stepTitles[step]}
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

        {/* 步骤指示器 */}
        <div className="flex items-center gap-2 mb-6">
          {step > 1 && (
            <button
              type="button"
              onClick={goBack}
              className="inline-flex w-7 h-7 items-center justify-center rounded-lg text-white/45 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
          )}
          <h2 className="text-[20px] font-semibold text-white">{stepTitles[step]}</h2>
          <span className="text-[12px] text-white/35 ml-auto">步骤 {step}/4</span>
        </div>

        {/* 进度条 */}
        <div className="flex gap-1.5 mb-6">
          {([1, 2, 3, 4] as Step[]).map((s) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${
                s <= step ? "bg-[#3b82f6]" : "bg-white/[0.08]"
              }`}
            />
          ))}
        </div>

        {/* ---- Step 1: 验证当前手机 ---- */}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-[12px] text-white/55 mb-1.5">当前手机号</label>
              <div className="h-10 flex items-center bg-white/[0.03] rounded-lg px-3 border border-white/[0.04] text-sm text-white/55">
                {maskPhone(user.phone)}
              </div>
            </div>
            <div>
              <label className="block text-[12px] text-white/55 mb-1.5">验证码</label>
              <div className="flex gap-2">
                <input
                  className="h-10 flex-1 bg-white/[0.05] rounded-lg px-3 border border-white/[0.06] focus:border-white/20 outline-none text-sm text-white/90 placeholder:text-white/30 transition-colors"
                  placeholder="请输入 6 位验证码"
                  maxLength={6}
                  value={currentCode}
                  onChange={(e) => {
                    setCurrentCode(e.target.value.replace(/\D/g, ""));
                    if (error) setError(null);
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") goNext(); }}
                />
                <button
                  type="button"
                  disabled={currentCodeSending || currentCountdown > 0}
                  onClick={handleSendCurrentCode}
                  className="inline-flex items-center h-10 px-3 rounded-lg text-[12px] font-medium shrink-0 transition-colors bg-white/[0.06] text-white/70 hover:bg-white/[0.12] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {currentCodeSending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : currentCountdown > 0 ? (
                    `${currentCountdown}s`
                  ) : currentCodeSent ? (
                    "重新发送"
                  ) : (
                    "发送验证码"
                  )}
                </button>
              </div>
            </div>
            {/* 图形验证码（非测试号） */}
            {!isTestPhone && captchaImage && (
              <div>
                <label className="block text-[12px] text-white/55 mb-1.5">图形验证码</label>
                <div className="flex gap-2">
                  <img
                    src={captchaImage}
                    alt="验证码"
                    className="h-10 w-24 rounded-lg cursor-pointer"
                    onClick={loadCaptcha}
                  />
                  <input
                    className="h-10 flex-1 bg-white/[0.05] rounded-lg px-3 border border-white/[0.06] focus:border-white/20 outline-none text-sm text-white/90 placeholder:text-white/30 transition-colors"
                    placeholder="图片验证码"
                    maxLength={4}
                    value={captchaAnswer}
                    onChange={(e) => setCaptchaAnswer(e.target.value)}
                  />
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={goNext}
              className="inline-flex items-center justify-center h-10 w-full rounded-lg bg-[#3b82f6] text-white text-sm font-medium hover:bg-[#2563eb] transition-colors mt-2"
            >
              下一步
            </button>
          </div>
        )}

        {/* ---- Step 2: 输入新手机号 ---- */}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-[12px] text-white/55 mb-1.5">新手机号</label>
              <input
                className="h-10 w-full bg-white/[0.05] rounded-lg px-3 border border-white/[0.06] focus:border-white/20 outline-none text-sm text-white/90 placeholder:text-white/30 transition-colors"
                placeholder="请输入新手机号"
                maxLength={11}
                value={newPhone}
                onChange={(e) => {
                  setNewPhone(e.target.value.replace(/\D/g, ""));
                  if (error) setError(null);
                }}
                onKeyDown={(e) => { if (e.key === "Enter") goNext(); }}
              />
            </div>
            <button
              type="button"
              onClick={goNext}
              className="inline-flex items-center justify-center h-10 w-full rounded-lg bg-[#3b82f6] text-white text-sm font-medium hover:bg-[#2563eb] transition-colors mt-2"
            >
              下一步
            </button>
          </div>
        )}

        {/* ---- Step 3: 验证新手机号 ---- */}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <div className="bg-white/[0.03] rounded-lg p-3 text-[13px] text-white/70">
              验证码将发送至 <span className="text-white/90 font-medium">{newPhone.trim()}</span>
            </div>
            <div>
              <label className="block text-[12px] text-white/55 mb-1.5">验证码</label>
              <div className="flex gap-2">
                <input
                  className="h-10 flex-1 bg-white/[0.05] rounded-lg px-3 border border-white/[0.06] focus:border-white/20 outline-none text-sm text-white/90 placeholder:text-white/30 transition-colors"
                  placeholder="请输入 6 位验证码"
                  maxLength={6}
                  value={newCode}
                  onChange={(e) => {
                    setNewCode(e.target.value.replace(/\D/g, ""));
                    if (error) setError(null);
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") goNext(); }}
                />
                <button
                  type="button"
                  disabled={newCodeSending || newCountdown > 0}
                  onClick={handleSendNewCode}
                  className="inline-flex items-center h-10 px-3 rounded-lg text-[12px] font-medium shrink-0 transition-colors bg-white/[0.06] text-white/70 hover:bg-white/[0.12] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {newCodeSending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : newCountdown > 0 ? (
                    `${newCountdown}s`
                  ) : newCodeSent ? (
                    "重新发送"
                  ) : (
                    "发送验证码"
                  )}
                </button>
              </div>
            </div>
            {/* 图形验证码（非测试号） */}
            {!isTestPhone && newPhone !== "15079999999" && captchaImage && (
              <div>
                <label className="block text-[12px] text-white/55 mb-1.5">图形验证码</label>
                <div className="flex gap-2">
                  <img
                    src={captchaImage}
                    alt="验证码"
                    className="h-10 w-24 rounded-lg cursor-pointer"
                    onClick={loadCaptcha}
                  />
                  <input
                    className="h-10 flex-1 bg-white/[0.05] rounded-lg px-3 border border-white/[0.06] focus:border-white/20 outline-none text-sm text-white/90 placeholder:text-white/30 transition-colors"
                    placeholder="图片验证码"
                    maxLength={4}
                    value={captchaAnswer}
                    onChange={(e) => setCaptchaAnswer(e.target.value)}
                  />
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={goNext}
              className="inline-flex items-center justify-center h-10 w-full rounded-lg bg-[#3b82f6] text-white text-sm font-medium hover:bg-[#2563eb] transition-colors mt-2"
            >
              下一步
            </button>
          </div>
        )}

        {/* ---- Step 4: 确认换绑 ---- */}
        {step === 4 && (
          <div className="flex flex-col gap-4">
            <div className="bg-white/[0.03] rounded-lg p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-white/55">当前手机号</span>
                <span className="text-white/70">{maskPhone(user.phone)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/55">新手机号</span>
                <span className="text-white/90 font-medium">{newPhone.trim()}</span>
              </div>
            </div>
            <p className="text-[12px] text-white/40">
              确认后，下次登录请使用新手机号
            </p>
            <button
              type="button"
              disabled={loading}
              onClick={handleConfirm}
              className="inline-flex items-center justify-center h-10 w-full rounded-lg bg-[#3b82f6] text-white text-sm font-medium hover:bg-[#2563eb] disabled:opacity-40 disabled:cursor-not-allowed transition-colors mt-2"
            >
              {loading ? (
                <>
                  <Loader2 size={14} className="animate-spin mr-2" />
                  换绑中...
                </>
              ) : (
                "确认换绑"
              )}
            </button>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <p className="mt-4 text-[12px] text-[#ef4444] text-center">{error}</p>
        )}
      </div>
    </div>
  );
}
