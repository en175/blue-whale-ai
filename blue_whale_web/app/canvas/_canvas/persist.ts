/**
 * persist —— 画布节点持久化过滤（design D5）
 *
 * loading（占位，无 assetId，刷新无法恢复）/ error（失败，无意义）不持久化；
 * 仅 ready（含无 status 的旧节点，兼容旧数据）入库。loading 节点刷新后靠
 * 刷新恢复（design D12 方案 A，扫 processing job 重建）续命，不靠持久化。
 */
import type { NodeItem } from "./types";

/**
 * 过滤可持久化节点：保留 ready + 无 status（旧数据视为 ready），剔除 loading/error。
 */
export function filterPersistableNodes(nodes: NodeItem[]): NodeItem[] {
  return nodes.filter((n) => n.status === undefined || n.status === "ready");
}
