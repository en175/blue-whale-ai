"use client";

import { useEffect, useState, type VideoHTMLAttributes } from "react";
import { apiRequest } from "@/lib/api-client";

type AssetAccess = { url: string; expires_at: string };

type AuthenticatedVideoProps = Omit<
  VideoHTMLAttributes<HTMLVideoElement>,
  "src"
> & {
  accessUrl: string;
};

export function AuthenticatedVideo({
  accessUrl,
  ...videoProps
}: AuthenticatedVideoProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const loadSignedUrl = async () => {
      try {
        const access = await apiRequest<AssetAccess>(accessUrl);
        if (cancelled) return;
        setSignedUrl(access.url);
        const expiresAt = Date.parse(access.expires_at);
        const refreshIn = Number.isFinite(expiresAt)
          ? Math.max(1_000, expiresAt - Date.now() - 30_000)
          : 240_000;
        refreshTimer = setTimeout(() => void loadSignedUrl(), refreshIn);
      } catch (error) {
        if (!cancelled) {
          console.warn("[canvas] video asset unavailable:", error);
        }
      }
    };
    void loadSignedUrl();
    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [accessUrl]);

  if (!signedUrl) return null;
  return <video {...videoProps} src={signedUrl} />;
}
