import type { CSSProperties } from 'react';

/** 外部标题共用的局部尺寸：屏幕目标值除以 Canvas 倍率，三类元素独立封顶。 */
export function nodeTitleSizing(zoom: number): CSSProperties {
  const localSize = (base: number, maximum: number) => {
    if (zoom < 0.75) return base / 0.75;
    if (zoom <= 1) return base / zoom;
    return Math.min(base * zoom, maximum) / zoom;
  };
  const name = localSize(12, 16);
  return {
    '--node-title-name': `${name}px`,
    '--node-title-meta': `${localSize(11, 14)}px`,
    '--node-title-icon': `${localSize(14, 18)}px`,
    '--node-title-line': `${name * 1.5}px`,
    '--node-title-gap': `${name / 2}px`,
    '--node-title-group-gap': `${name}px`,
  } as CSSProperties;
}
