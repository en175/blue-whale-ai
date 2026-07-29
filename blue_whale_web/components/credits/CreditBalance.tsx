"use client";

import { Coins } from "lucide-react";
import { useEffect, useState } from "react";

import { apiRequest } from "@/lib/api-client";
import { quotaToCredits } from "@/lib/credits";
import { loadAccessToken } from "@/components/auth/authStorage";

export function CreditBalance({ compact = false }: { compact?: boolean }) {
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    if (!loadAccessToken()) return;
    let active = true;
    apiRequest<{ quota: number }>("/api/usage/token")
      .then(({ quota }) => {
        if (active) setCredits(quotaToCredits(quota));
      })
      .catch(() => {
        if (active) setCredits(null);
      });
    return () => {
      active = false;
    };
  }, []);

  if (credits === null) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-white/70 ${compact ? "text-[12px]" : "text-[13px]"}`}
      aria-label={`积分余额 ${credits}`}
      title="积分余额"
    >
      <Coins size={compact ? 14 : 15} aria-hidden="true" />
      <span className="tabular-nums">{credits.toLocaleString()}</span>
    </span>
  );
}
