/* ============================================
 * mediaReEdit 成功卡原卡编辑与重新生成（IKDMQU）：
 * 成品卡「有生成记录」判定、生成任务原位承接判定、取消终态处置。
 * 生成记录以节点 data.jobId 为准——生成任务创建即写入、成功后不清除、
 * 随画布保存与水合持久保留；上传素材卡无该字段（Q4 不自动开面板）。
 * ============================================ */
import type { Node } from '@xyflow/react';

/** 节点 data 是否携带生成任务 id（兼容 string/number 历史形态） */
function readJobId(data: { jobId?: unknown } | undefined): string | number | undefined {
  const raw = data?.jobId;
  return typeof raw === 'string' || typeof raw === 'number' ? raw : undefined;
}

/** 成品卡「有生成记录」判定（无 Node 上下文）：jobId 存在且非草稿。
 *  点卡片打开绑定面板（onNodeClick，IKH3WE 起重新编辑唯一入口）与 hasGenerationRecord 共用此口径（IKGX5M）。 */
export function hasGenerationRecordData(data: { jobId?: unknown; draft?: unknown } | undefined): boolean {
  return data?.draft !== true && readJobId(data) !== undefined;
}

/** 成品卡「有生成记录」判定：媒体节点 + 已有生成任务。
 *  含重新生成中的卡（jobId 在、genStatus=generating）；不含待生成草稿与上传素材卡。 */
export function hasGenerationRecord(node: Node | undefined): boolean {
  if (!node || node.type !== 'mediaNode') return false;
  return hasGenerationRecordData(node.data as { jobId?: unknown; draft?: unknown } | undefined);
}

/** 生成任务原位承接判定（Q1）：草稿身份节点（IKDMQQ）或有生成记录的成品卡（IKDMQU）。
 *  其余目标（上传素材卡、无目标）仍走新建占位卡路径。 */
export function isInPlaceRegenTarget(node: Node | undefined): boolean {
  if (!node || node.type !== 'mediaNode') return false;
  const data = (node.data ?? {}) as Record<string, unknown>;
  if (data.draft === true) return true;
  return hasGenerationRecord(node);
}

/** 取消终态处置（IKDMQU Q5 + IKDMQW）三分支：
 *  to-draft 草稿卡回待生成（保留参数与连线）；restore 有旧素材的成品卡恢复成品态；
 *  remove 其余（无旧素材的历史占位卡）移除——没有可保留的内容。 */
export function cancelledTerminalAction(node: Node | undefined): 'to-draft' | 'restore' | 'remove' {
  if (!node || node.type !== 'mediaNode') return 'remove';
  const data = (node.data ?? {}) as Record<string, unknown>;
  if (data.draft === true) return 'to-draft';
  if (hasGenerationRecord(node) && hasSettledMediaSrc(data)) return 'restore';
  return 'remove';
}

/** 有效旧素材判定（与 MediaNode 展示口径一致）：http(s) 素材算旧素材，blob 预览不算 */
function hasSettledMediaSrc(data: Record<string, unknown>): boolean {
  const src = data.src;
  return typeof src === 'string' && src !== '' && !src.startsWith('blob:');
}
