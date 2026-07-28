"use client";
/**
 * QRCode — 二维码展示 + 倒计时 + 过期覆盖层
 *
 * 展示后端返回的二维码图片，同时运行 15 分钟倒计时。
 * 过期后显示蒙层 + 「点击刷新」按钮。
 */
import { useEffect, useRef, useState } from "react";
import { QR_EXPIRE_SECONDS } from "./constants";

interface QRCodeProps {
  qrCodeUrl: string;
  /** ISO 8601 过期时间 */
  expireTime: string;
  onRegenerate: () => void;
}

/** 格式化剩余秒数为 mm:ss */
function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function QRCode({ qrCodeUrl, expireTime, onRegenerate }: QRCodeProps) {
  const [remaining, setRemaining] = useState(() => {
    const initial = Math.floor(
      (new Date(expireTime).getTime() - Date.now()) / 1000,
    );
    return Math.max(0, Math.min(initial, QR_EXPIRE_SECONDS));
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (remaining <= 0) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    timerRef.current = setTimeout(() => {
      setRemaining((c) => Math.max(0, c - 1));
    }, 1000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [remaining]);

  const isExpired = remaining <= 0;

  return (
    <div className="relative flex flex-col items-center gap-3">
      {/* 二维码图片 */}
      <div className="relative w-[200px] h-[200px] rounded-xl border border-[var(--tc-border-subtle,rgba(255,255,255,0.08))] bg-white p-2">
        <img
          src={qrCodeUrl}
          alt="支付二维码"
          className="w-full h-full object-contain"
        />

        {/* 过期覆盖层 */}
        {isExpired && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/70 backdrop-blur-sm">
            <p className="text-[13px] text-white/80">二维码已过期</p>
            <button
              type="button"
              onClick={onRegenerate}
              className="inline-flex items-center px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[var(--tc-accent,#3b82f6)] text-[var(--tc-on-accent,#ffffff)] hover:opacity-90 transition-opacity"
            >
              点击刷新
            </button>
          </div>
        )}
      </div>

      {/* 倒计时 */}
      {!isExpired && (
        <span className="text-[12px] tabular-nums text-[var(--tc-muted,rgba(255,255,255,0.4))]">
          {fmtTime(remaining)} 后过期
        </span>
      )}
    </div>
  );
}
