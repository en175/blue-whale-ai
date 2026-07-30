"use client";
import { useEffect, useState } from "react";

/**
 * BootProgress —— 画布启动期 boot 屏：简洁的假进度条（苹果开机式）。
 *
 * 覆盖「必要启动」全段：项目列表 → 画布 doc → snapshot 水合。
 * progress 不反映真实刻度（各阶段无统一进度），用 ease-out 在 ~2.2s 内从 8% 逼近 92% 后保持，
 * 组件在启动完成时卸载即可——既给「正在推进」的反馈，又避免卡 99% 的焦虑。
 * 错误态（项目不存在 / 加载失败）不走本组件，由调用方渲染重试 UI。
 */
export function BootProgress({ label = "正在加载画布" }: { label?: string }) {
  const [progress, setProgress] = useState(8);
  useEffect(() => {
    const start = performance.now();
    const DURATION = 2200;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setProgress(8 + eased * 84); // 8% → 92%
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-black">
      <div className="flex w-56 flex-col items-center gap-4">
        <div
          className="h-[3px] w-full overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          aria-label={label}
        >
          <div
            className="h-full rounded-full bg-white/80"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-[11px] text-white/35">{label}</p>
      </div>
    </div>
  );
}
