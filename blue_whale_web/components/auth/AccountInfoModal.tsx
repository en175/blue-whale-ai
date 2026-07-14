"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useAuth } from "./AuthContext";
import { maskPhone } from "./phoneUtils";

interface AccountInfoModalProps {
  onClose: () => void;
  onOpenRebind: () => void;
}

export function AccountInfoModal({ onClose, onOpenRebind }: AccountInfoModalProps) {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
