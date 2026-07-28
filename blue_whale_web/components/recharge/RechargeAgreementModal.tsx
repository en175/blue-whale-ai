"use client";
/**
 * RechargeAgreementModal — 充值协议二级弹窗
 *
 * 从 RechargeModal 中 "《充值协议》" 链接打开。
 * 调用 getRechargeAgreement() 获取协议内容并展示。
 * 状态：loading → content / error。
 */
import { useEffect, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { ModalShell } from "@/components/auth/ModalShell";
import { getRechargeAgreement } from "@/lib/api/recharge";

interface RechargeAgreementModalProps {
  onClose: () => void;
}

export function RechargeAgreementModal({
  onClose,
}: RechargeAgreementModalProps) {
  const [title, setTitle] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRechargeAgreement()
      .then((res) => {
        setTitle(res.title);
        setContent(res.content);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "加载协议失败");
      });
  }, []);

  return (
    <ModalShell
      ariaLabel="充值协议"
      onClose={onClose}
      width={480}
      zIndex={2147483614}
    >
      {error ? (
        /* error */
        <div className="flex flex-col items-center gap-3 py-8">
          <AlertCircle size={36} className="text-[var(--tc-destructive,#ef4444)]" />
          <p className="text-[14px] text-[var(--tc-secondary,rgba(255,255,255,0.7))]">
            {error}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center px-4 py-2 rounded-lg text-[13px] font-medium bg-[var(--tc-accent,#3b82f6)] text-[var(--tc-on-accent,#ffffff)] hover:opacity-90 transition-opacity"
          >
            关闭
          </button>
        </div>
      ) : !title ? (
        /* loading */
        <div className="flex flex-col items-center gap-3 py-8">
          <Loader2 size={36} className="animate-spin text-[var(--tc-accent,#3b82f6)]" />
          <p className="text-[14px] text-[var(--tc-muted,rgba(255,255,255,0.4))]">
            加载协议...
          </p>
        </div>
      ) : (
        /* content */
        <div>
          <h2 className="text-[20px] font-semibold leading-tight mb-4 text-[var(--tc-primary,#ffffff)]">
            {title}
          </h2>
          <div className="text-[13px] text-[var(--tc-secondary,rgba(255,255,255,0.7))] leading-relaxed whitespace-pre-wrap max-h-[60vh] overflow-y-auto">
            {content}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
