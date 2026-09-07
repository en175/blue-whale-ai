/* ============================================
 * mediaReEdit 成功卡原卡编辑与重新生成（IKDMQU）：
 * 成品卡「有生成记录」判定、生成任务原位承接判定、取消终态处置。
 * 生成记录以节点 data.jobId 为准——生成任务创建即写入、成功后不清除、
 * 随画布保存与水合持久保留；上传素材卡无该字段（Q4 不自动开面板）。
 * ============================================ */
import type { Node } from '@xyflow/react';

/** 节点 data 是否携带生成任务 id（兼容 string/number 历史形态） */
function readJobId(data: Record<string, unknown> | undefined): string | number | undefined {
  const raw = data?.jobId;
  return typeof raw === 'string' || typeof raw === 'number' ? raw : undefined;
}

/** 成品卡「有生成记录」判定：媒体节点 + 已有生成任务。
 *  含重新生成中的卡（jobId 在、genStatus=generating）；不含待生成草稿与上传素材卡。 */
export function hasGenerationRecord(node: Node | undefined): boolean {
  if (!node || node.type !== 'mediaNode') return false;
  const data = (node.data ?? {}) as Record<string, unknown>;
  return data.draft !== true && readJobId(data) !== undefined;
}

/** 生成任务原位承接判定（Q1）：草稿身份节点（IKDMQQ）或有生成记录的成品卡（IKDMQU）。
 *  其余目标（上传素材卡、无目标）仍走新建占位卡路径。 */
export function isInPlaceRegenTarget(node: Node | undefined): boolean {
  if (!node || node.type !== 'mediaNode') return false;
  const data = (node.data ?? {}) as Record<string, unknown>;
  if (data.draft === true) return true;
  return hasGenerationRecord(node);
}

/** 取消终态处置（Q5）：成品卡恢复成品态保留旧素材与最新编辑；
 *  草稿/历史占位卡维持既有删除路径（普通取消回待生成属后续切片）。 */
export function cancelledTerminalAction(node: Node | undefined): 'restore' | 'remove' {
  return hasGenerationRecord(node) ? 'restore' : 'remove';
}
