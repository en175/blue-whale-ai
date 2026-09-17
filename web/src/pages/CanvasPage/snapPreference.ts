/* IKGGCT T3：画布对齐吸附开关的持久化。全局一份（不分画布文档），
 * 存 localStorage；读写收敛在这里，key 约定与 drawerWidth.ts 的
 * bw-agent-panel-width 同风格（bw- 前缀 + kebab-case）。 */

/** 吸附开关持久化 key（全局生效，不按画布文档区分）。 */
export const SNAP_ALIGNMENT_STORAGE_KEY = 'bw-canvas-snap-alignment';

/** 读取持久化的吸附开关；无记录或存储值非法时回退默认开启。 */
export function readSnapAlignmentEnabled(): boolean {
  return localStorage.getItem(SNAP_ALIGNMENT_STORAGE_KEY) !== 'off';
}

/** 持久化吸附开关（左下角磁铁按钮切换时写入）。 */
export function persistSnapAlignmentEnabled(enabled: boolean): void {
  localStorage.setItem(SNAP_ALIGNMENT_STORAGE_KEY, enabled ? 'on' : 'off');
}
