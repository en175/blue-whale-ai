"use client";
/* eslint-disable @next/next/no-img-element -- Blob URL 由带认证的资源请求生成，不能交给 next/image 优化器。 */

import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { apiFetch } from "@/lib/api-client";

type AuthenticatedImageProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "alt"
> & {
  accessUrl: string;
  alt: string;
};

export function AuthenticatedImage({
  accessUrl,
  alt,
  ...imageProps
}: AuthenticatedImageProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let currentObjectUrl: string | null = null;
    void apiFetch(accessUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok)
          throw new Error(`Asset request failed: ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        if (controller.signal.aborted) return;
        currentObjectUrl = URL.createObjectURL(blob);
        setObjectUrl(currentObjectUrl);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.warn("[canvas] asset unavailable:", error);
        }
      });
    return () => {
      controller.abort();
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    };
  }, [accessUrl]);

  if (!objectUrl) return null;
  return <img {...imageProps} src={objectUrl} alt={alt} />;
}
