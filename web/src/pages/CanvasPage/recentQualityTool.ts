/* ============================================
 * IKGZ5P「高清 ▾」触发钮最近工具记忆（纯逻辑，无 React 依赖，打法同 imageCutout.ts）：
 * 最近使用的画质工具是全局单值（不分画布文档、跨卡片共享），localStorage 单 key 持久
 * （key 约定与 snapPreference.ts 的 bw- 前缀 + kebab-case 同风格），无记录时默认「高清」。
 * 写入收敛在 persistRecentQualityTool 单一入口（菜单选择与触发钮直启两条路径共用），
 * 写后通知订阅者（useSyncExternalStore 的订阅形态）——任一卡上使用工具即同步刷新
 * 全部图片卡触发钮文案。读取对无 localStorage / 坏值回退默认，不拦截渲染。
 * ============================================ */

/** 画质工具 id（与 MediaNode qualityMenuItems 数组各项 id 同源） */
export type RecentQualityToolId = 'enhance' | 'outpaint' | 'crop' | 'erase' | 'cutout';

/** 最近画质工具持久化 key（全局单值，不按画布文档/卡片区分）。 */
export const RECENT_QUALITY_TOOL_STORAGE_KEY = 'bw-recent-quality-tool';

/** 默认最近工具：从未使用过任何画质工具时触发钮显示「高清」。 */
export const DEFAULT_RECENT_QUALITY_TOOL: RecentQualityToolId = 'enhance';

const RECENT_QUALITY_TOOL_IDS: readonly string[] = ['enhance', 'outpaint', 'crop', 'erase', 'cutout'];

function isRecentQualityToolId(value: string | null): value is RecentQualityToolId {
  return value != null && RECENT_QUALITY_TOOL_IDS.includes(value);
}

/** 读取最近使用的画质工具；无记录 / 坏值 / 无 localStorage 时回默认「高清」。 */
export function readRecentQualityTool(): RecentQualityToolId {
  try {
    const raw = localStorage.getItem(RECENT_QUALITY_TOOL_STORAGE_KEY);
    if (isRecentQualityToolId(raw)) return raw;
  } catch {
    // 无 localStorage（禁用存储等）回默认，不拦截渲染
  }
  return DEFAULT_RECENT_QUALITY_TOOL;
}

const listeners = new Set<() => void>();

/** 订阅最近工具变化（useSyncExternalStore 订阅函数形态）；返回退订函数。 */
export function subscribeRecentQualityTool(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 单一写入点：任一画质工具启动（菜单选择 / 触发钮直启）时写入并通知订阅者；
 *  非法 id 忽略不写（防脏数据入 storage）；无 localStorage 时跳过持久化仍通知。 */
export function persistRecentQualityTool(id: string): void {
  if (!isRecentQualityToolId(id)) return;
  try {
    localStorage.setItem(RECENT_QUALITY_TOOL_STORAGE_KEY, id);
  } catch {
    // 无 localStorage 时跳过持久化（读取侧回默认兜底）
  }
  listeners.forEach((listener) => listener());
}
