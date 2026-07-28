"use client";
/**
 * usePolling — 通用轮询 hook
 *
 * 按 interval 调用 fetcher，enabled=false 或组件卸载时自动停止。
 * 连续失败达 maxErrors 时触发 onMaxErrors 回调。
 *
 * @param fetcher - 异步获取函数
 * @param interval - 轮询间隔（毫秒）
 * @param enabled - 是否启用轮询
 * @param maxErrors - 连续失败上限，默认 3
 * @param onSuccess - 成功回调（可选）
 * @param onMaxErrors - 达到最大错误数回调（可选）
 * @returns { isPolling, errorCount } 当前轮询状态
 */
import { useEffect, useRef, useState, useCallback } from "react";

interface UsePollingOptions<T> {
  fetcher: () => Promise<T>;
  interval: number;
  enabled: boolean;
  maxErrors?: number;
  onSuccess?: (data: T) => void;
  onMaxErrors?: () => void;
}

export function usePolling<T>({
  fetcher,
  interval,
  enabled,
  maxErrors = 3,
  onSuccess,
  onMaxErrors,
}: UsePollingOptions<T>) {
  const [isPolling, setIsPolling] = useState(false);
  const [errorCount, setErrorCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  // 用 ref 持有最新回调，避免 fetcher/onSuccess 变化触发轮询重启
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const onMaxErrorsRef = useRef(onMaxErrors);
  onMaxErrorsRef.current = onMaxErrors;
  const maxErrorsRef = useRef(maxErrors);
  maxErrorsRef.current = maxErrors;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setIsPolling(false);
      clearTimer();
      return;
    }

    setIsPolling(true);
    stoppedRef.current = false;

    const poll = async () => {
      if (stoppedRef.current) return;
      try {
        const data = await fetcherRef.current();
        if (stoppedRef.current) return;
        setErrorCount(0);
        onSuccessRef.current?.(data);
      } catch {
        if (stoppedRef.current) return;
        setErrorCount((c) => {
          const next = c + 1;
          if (next >= maxErrorsRef.current) {
            onMaxErrorsRef.current?.();
          }
          return next;
        });
      }
      if (!stoppedRef.current) {
        timerRef.current = setTimeout(poll, interval);
      }
    };

    poll();

    return () => {
      stoppedRef.current = true;
      clearTimer();
      setIsPolling(false);
    };
  }, [enabled, interval, clearTimer]);

  const degraded = errorCount >= maxErrors;

  return { isPolling, errorCount, degraded };
}
