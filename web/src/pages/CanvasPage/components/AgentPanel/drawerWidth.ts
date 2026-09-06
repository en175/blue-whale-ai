/**
 * AgentChatPanel 停靠抽屉的宽度规则（IKDLD4）。
 *
 * 与 layout.ts 同一先例：量测（window.innerWidth、localStorage）与决策分离，
 * 这里只做纯计算，视口宽由调用方传入，单测不需要碰 window。
 */

/** 默认宽度：对齐参照物的实测值（原 .panel 固定宽度，IKAGZC）。 */
export const DEFAULT_PANEL_WIDTH = 468;
/** 下限：再窄输入区就难用了。 */
export const MIN_PANEL_WIDTH = 400;
/** 上限：再宽就喧宾夺主；实际生效上限还要与 50vw 取较小者。 */
export const MAX_PANEL_WIDTH = 720;
/** 宽度持久化 key（全局一份，不按 Project 分；展开状态不持久化）。 */
export const PANEL_WIDTH_STORAGE_KEY = 'bw-agent-panel-width';

/**
 * 把目标宽度收进 [min, max]：上限 min(720, 50vw)；极窄视口（50vw < 400）下限让位于
 * 可用宽度（视口宽 − 左侧工具栏 60px），保证小屏下面板不被挤没。
 */
export function clampPanelWidth(width: number, viewportWidth: number): number {
  const min = Math.min(MIN_PANEL_WIDTH, viewportWidth - 60);
  const max = Math.max(Math.min(MAX_PANEL_WIDTH, viewportWidth * 0.5), min);
  return Math.min(Math.max(width, min), max);
}

/** 读取持久化宽度并按当前视口钳制；无记录或值损坏时回退默认宽度。 */
export function readPersistedPanelWidth(viewportWidth: number): number {
  const saved = Number(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY));
  return clampPanelWidth(saved > 0 ? saved : DEFAULT_PANEL_WIDTH, viewportWidth);
}

/** 写入持久化宽度（拖拽松手 / 双击复位时才写，拖拽途中不写）。 */
export function persistPanelWidth(width: number): void {
  localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(width));
}
