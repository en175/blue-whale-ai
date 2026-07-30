"use client";
/**
 * QRCode — 二维码展示 + 倒计时 + 过期覆盖层
 *
 * 后端返回支付链接（如 weixin://wxpay/...），前端用 qrcode 库将其转为
 * data URI 二维码图片展示。同时运行倒计时，过期后显示蒙层 + 刷新按钮。
 */
import { useEffect, useRef, useState } from "react";
import QRCodeLib from "qrcode";
import { QR_EXPIRE_SECONDS } from "./constants";

interface QRCodeProps {
  /** 支付链接或图片 URL */
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

/** 支付链接 → QR data URI */
async function generateQRDataUri(url: string): Promise<string> {
  // 已是 data URI 直接返回
  if (url.startsWith("data:")) {
    return url;
  }
  // 支付链接（weixin:// / https:// 等）→ 生成二维码
  return QRCodeLib.toDataURL(url, {
    width: 400,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

export function QRCode({ qrCodeUrl, expireTime, onRegenerate }: QRCodeProps) {
  const [qrDataUri, setQrDataUri] = useState<string>("");
  const [remaining, setRemaining] = useState(() => {
    const initial = Math.floor(
      (new Date(expireTime).getTime() - Date.now()) / 1000,
    );
    return Math.max(0, Math.min(initial, QR_EXPIRE_SECONDS));
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 生成二维码图片
  useEffect(() => {
    let cancelled = false;
    generateQRDataUri(qrCodeUrl).then((uri) => {
      if (!cancelled) setQrDataUri(uri);
    });
    return () => {
      cancelled = true;
    };
  }, [qrCodeUrl]);

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
        {qrDataUri ? (
          <img
            src={qrDataUri}
            alt="支付二维码"
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
          </div>
        )}

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
