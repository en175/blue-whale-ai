/* ============================================
 * 音视频合成（IKIHPK，父规格 IKIHMX / ADR-0115）：纯逻辑，无 React 依赖。
 * 音频卡工具条第四钮「音视频合成」的入口门槛、视频绑定源校验、合成草稿卡身份与两类
 * 语义边识别集中于此——拖线落点分流（落草稿卡转绑定）、固定音频输入线删除守卫、
 * 参考推导排除（audioMediaRefs）三处消费同一判定，不各自复制。
 *
 * 形态要点（规格「已确认的产品边界」）：
 * - 入口门槛 = 已完成音频成品卡 + 仅源音频 URL 缺失置灰（时长/分辨率元数据缺失不拦）；
 * - 草稿卡从创建起即视频型并标注「音视频合成」，合成身份（固定音频源 + 绑定视频 + 两档
 *   参数）随卡持久化、记住直到终态回填（重试/恢复归 IKIHP M）；
 * - 默认音频输入线（源音频卡 → 草稿卡）与视频绑定线（视频卡 → 草稿卡）均为
 *   origin=audio-video-mux 的专用语义边：参考推导与 @ 编号按 origin 跳过（音频混合同
 *   款坑位），两者按来源节点身份再分流（固定源线不可单独删、绑定线删除即解绑）；
 * - 视频绑定只接受已完成、关联资产的视频成品卡（同一时刻只绑一个，重绑即替换）。
 * ============================================ */
import type { Edge, Node } from '@xyflow/react';
import { readAssetId } from './mediaRefs';

/** 合成语义边标记（写 edge.data.origin）：参考推导/@ 编号跳过此来源边（防参考污染） */
export const AUDIO_VIDEO_MUX_EDGE_ORIGIN = 'audio-video-mux';

/** 草稿卡标题（卡名与面板标题同源） */
export const AUDIO_VIDEO_MUX_TITLE = '音视频合成';

/** 入口置灰原因（唯一）：仅源音频 URL 缺失或不可用（上传中 blob / 空串）时展示 */
export const AUDIO_VIDEO_MUX_UNAVAILABLE_REASON = '音频不可用，无法合成';

/** 入口置灰原因：非已完成音频成品卡（草稿/生成中/失败/非音频卡） */
export const AUDIO_VIDEO_MUX_UNSUPPORTED_REASON = '仅支持已完成的音频卡';

/** 绑定拒绝原因：来源不是视频卡 */
export const AUDIO_VIDEO_MUX_VIDEO_UNSUPPORTED_REASON = '仅支持绑定视频卡';

/** 绑定拒绝原因：视频卡未完成（草稿/生成中/失败）或素材不可用（URL 缺失/未关联资产） */
export const AUDIO_VIDEO_MUX_VIDEO_UNAVAILABLE_REASON = '视频不可用，无法绑定';

/** 固定音频输入线删除拦截提示（只有删除草稿卡才解除） */
export const AUDIO_VIDEO_MUX_AUDIO_EDGE_LOCKED_REASON = '固定音频源不可移除，删除合成卡才解除';

/** 时长对齐三档（规格「全为裁剪语义」；none=保持原长不传 is_video_audio_sync） */
export type AudioVideoMuxSync = 'none' | 'video' | 'audio';

/** 已绑定视频（画布拖线带 nodeId，素材库选择无 nodeId——来源标注据此分流） */
export interface AudioVideoMuxBoundVideo {
  assetId: string;
  nodeId?: string;
  name: string;
  duration?: number | null;
}

/** 合成草稿卡身份（随卡持久化，记住直到终态回填）：固定音频源 + 参数 + 可选绑定视频 */
export interface AudioVideoMuxIdentity {
  /** 固定音频源卡节点 id（默认音频输入线不可单独删，按此识别） */
  sourceNodeId: string;
  /** 固定音频源资产 id（提交冻结；缺失不拦入口，由服务端复核） */
  sourceAssetId?: string;
  /** 原声处理：true 保留原声（默认，混音）/ false 替换原声（映射 is_audio_reserve） */
  reserveAudio: boolean;
  /** 时长对齐：'none' 保持原长（默认）/ 'video' 裁到视频长 / 'audio' 裁到音频长 */
  sync: AudioVideoMuxSync;
  /** 已绑定视频；未绑定/解绑后为 undefined */
  video?: AudioVideoMuxBoundVideo;
}

/** 原声处理两档（保留原声默认；面板分段渲染与测试断言同源） */
export const AUDIO_VIDEO_MUX_RESERVE_OPTIONS: ReadonlyArray<{ value: boolean; label: string }> = [
  { value: true, label: '保留原声' },
  { value: false, label: '替换原声' },
];

/** 时长对齐三档（保持原长默认；档位值即冻结 sync 单字段） */
export const AUDIO_VIDEO_MUX_SYNC_OPTIONS: ReadonlyArray<{ value: AudioVideoMuxSync; label: string }> = [
  { value: 'none', label: '保持原长' },
  { value: 'video', label: '裁到视频长' },
  { value: 'audio', label: '裁到音频长' },
];

/** 新建草稿卡的身份：默认「保留原声 + 保持原长」 */
export function buildAudioVideoMuxIdentity(sourceNodeId: string, sourceAssetId?: string): AudioVideoMuxIdentity {
  return { sourceNodeId, sourceAssetId, reserveAudio: true, sync: 'none' };
}

/** 卡上合成身份（无身份返回 undefined） */
export function audioVideoMuxIdentityOf(node: Node | undefined): AudioVideoMuxIdentity | undefined {
  if (!node || node.type !== 'mediaNode') return undefined;
  const identity = ((node.data ?? {}) as Record<string, unknown>).audioVideoMux;
  if (!identity || typeof identity !== 'object') return undefined;
  const candidate = identity as AudioVideoMuxIdentity;
  return typeof candidate.sourceNodeId === 'string' && candidate.sourceNodeId !== '' ? candidate : undefined;
}

/** 未发送的合成草稿卡（未绑定/绑定中/已绑定都是它）：拖线绑定目标与固定音频线守卫的识别依据。
 *  已发送占位卡（genStatus=generating）不再是绑定目标（重试/回填归 IKIHP M）。 */
export function isAudioVideoMuxDraftNode(node: Node | undefined): boolean {
  if (audioVideoMuxIdentityOf(node) === undefined) return false;
  const data = (node!.data ?? {}) as Record<string, unknown>;
  return data.genStatus === 'draft';
}

/** 媒体 data 的成品判定：genStatus 有值即非成品（draft/generating/failed/cancelled） */
function isFinishedCard(data: Record<string, unknown>): boolean {
  return !(typeof data.genStatus === 'string' && data.genStatus !== '');
}

/** 工具条「音视频合成」门槛（返回置灰原因，null=可点）：已完成音频成品卡 + 仅 URL 缺失置灰。
 *  时长、分辨率元数据缺失不拦（音视频分离「未关联资产」同款宽松口径）；上传中 blob 预览
 *  不可作为任务输入，与空 URL 同口径拦下。 */
export function audioVideoMuxSourceError(data: Record<string, unknown> | undefined): string | null {
  if (!data || data.mediaType !== 'audio') return AUDIO_VIDEO_MUX_UNSUPPORTED_REASON;
  if (!isFinishedCard(data)) return AUDIO_VIDEO_MUX_UNSUPPORTED_REASON;
  const src = typeof data.src === 'string' ? data.src : '';
  if (!src || src.startsWith('blob:')) return AUDIO_VIDEO_MUX_UNAVAILABLE_REASON;
  return null;
}

/** 拖线绑定源校验（返回拒绝原因，null=可绑定）：只接受已完成、关联资产的视频成品卡；
 *  非视频卡、生成中卡、无资产/无 URL 的卡不接受（规格「候选视频卡必须是已完成、
 *  关联资产的视频成品卡」）。 */
export function audioVideoMuxVideoError(node: Node | undefined): string | null {
  if (!node || node.type !== 'mediaNode') return AUDIO_VIDEO_MUX_VIDEO_UNSUPPORTED_REASON;
  const data = (node.data ?? {}) as Record<string, unknown>;
  if (data.mediaType !== 'video') return AUDIO_VIDEO_MUX_VIDEO_UNSUPPORTED_REASON;
  if (!isFinishedCard(data)) return AUDIO_VIDEO_MUX_VIDEO_UNSUPPORTED_REASON;
  const src = typeof data.src === 'string' ? data.src : '';
  if (!src || src.startsWith('blob:')) return AUDIO_VIDEO_MUX_VIDEO_UNAVAILABLE_REASON;
  if (readAssetId(data) === undefined) return AUDIO_VIDEO_MUX_VIDEO_UNAVAILABLE_REASON;
  return null;
}

/** 合成语义边：origin 标记 + 目标是合成草稿卡（其余 origin 边与普通参考线不在此列） */
function isAudioVideoMuxEdgeOfDraft(edge: Edge, draft: Node | undefined): boolean {
  if (draft === undefined) return false;
  if ((edge.data as { origin?: string } | undefined)?.origin !== AUDIO_VIDEO_MUX_EDGE_ORIGIN) return false;
  return edge.target === draft.id;
}

/** 固定音频输入线（源音频卡 → 草稿卡）：随草稿卡持久化、不可单独删 */
export function isAudioVideoMuxAudioEdge(edge: Edge, draft: Node | undefined): boolean {
  const identity = audioVideoMuxIdentityOf(draft);
  if (!identity || !isAudioVideoMuxEdgeOfDraft(edge, draft)) return false;
  return edge.source === identity.sourceNodeId;
}

/** 视频绑定线（视频卡 → 草稿卡）：删除即解绑重选（素材库绑定不建边） */
export function isAudioVideoMuxBindEdge(edge: Edge, draft: Node | undefined): boolean {
  const identity = audioVideoMuxIdentityOf(draft);
  if (!identity || !isAudioVideoMuxEdgeOfDraft(edge, draft)) return false;
  return edge.source !== identity.sourceNodeId;
}
