import type { Edge, Node } from '@xyflow/react';
import type { JobRecord } from '@/api/jobs';
import { AUDIO_MIX_OUTPUT_FORMATS, type AudioMixCreate } from '@lib/contracts/audio-mix';
import { baseSourceError, readAssetId } from './mediaRefs';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';

export const AUDIO_MIX_EDGE_ORIGIN = 'audio-mix';
export const AUDIO_MIX_FORMATS = AUDIO_MIX_OUTPUT_FORMATS;
export type AudioMixFormat = AudioMixCreate['output_format'];

/** 编辑期选材。assetId 是跨入口身份；nodeId 仅表示用户确实选了画布卡。 */
export interface AudioMixInputSelection {
  assetId: string;
  nodeId?: string;
  name: string;
  duration?: number | null;
}

export function audioMixSourceError(node: Node | undefined): string | null {
  if (!node || node.type !== 'mediaNode' || node.data?.mediaType !== 'audio') return '仅支持已完成的音频卡';
  return baseSourceError(node);
}

export function audioMixCandidate(source: Node, candidate: Node): boolean {
  if (source.id === candidate.id || audioMixSourceError(candidate)) return false;
  const sourceAssetId = readAssetId(source.data);
  const candidateAssetId = readAssetId(candidate.data);
  return sourceAssetId != null && candidateAssetId != null && sourceAssetId !== candidateAssetId;
}

function nodeBox(node: Node) {
  const data = node.data ?? {};
  const mediaBox = node.type === 'mediaNode'
    ? mediaContentBox({
        mediaType: data.mediaType as 'image' | 'video' | 'audio' | undefined,
        width: typeof data.width === 'number' ? data.width : undefined,
        height: typeof data.height === 'number' ? data.height : undefined,
        ratio: typeof data.targetRatio === 'string' ? data.targetRatio : undefined,
      })
    : { width: 320, height: 296 };
  return { x: node.position.x, y: node.position.y, width: mediaBox.width, height: mediaBox.height + 44 };
}

/** 从固定源右侧开始逐行找空位，所有画布节点均参与避让。 */
export function findAudioMixPosition(source: Node, occupied: Node[]): { x: number; y: number } {
  const anchor = nodeBox(source);
  const width = 480;
  const height = 284;
  const x = Math.round(anchor.x + anchor.width + 60);
  for (let row = 0; row <= occupied.length; row += 1) {
    const y = Math.round(anchor.y + row * (height + 60));
    const collision = occupied.some((node) => {
      const box = nodeBox(node);
      return x < box.x + box.width + 24 && x + width + 24 > box.x
        && y < box.y + box.height + 24 && y + height + 24 > box.y;
    });
    if (!collision) return { x, y };
  }
  return { x, y: Math.round(anchor.y + (occupied.length + 1) * (height + 60)) };
}

export function audioMixNodeId(jobId: string | number): string {
  return `audio-mix-${jobId}`;
}

export function isAudioMixNodeId(id: string): boolean {
  return id.startsWith('audio-mix-');
}

export function buildAudioMixPlaceholderNode(
  jobId: string | number,
  format: AudioMixFormat,
  position: { x: number; y: number },
): Node {
  return {
    id: audioMixNodeId(jobId),
    type: 'mediaNode',
    position,
    data: {
      src: '',
      fileName: `混合结果.${format}`,
      mediaType: 'audio',
      genStatus: 'generating',
      progress: 0,
      jobId,
      toolMode: 'select',
      audioMix: { format },
    },
  };
}

/** 以服务端任务为准恢复画布；仅 pending 且尚未落盘的任务可补卡。 */
export function planAudioMixRecovery(
  nodes: Node[],
  edges: Edge[],
  jobs: JobRecord[],
  occupied: Node[] = nodes,
): { nodes: Node[]; edges: Edge[]; pollJobIds: string[] } {
  let nextNodes = nodes;
  let nextEdges = edges;
  const pollJobIds: string[] = [];
  for (const job of jobs) {
    if (job.type !== 'audio_mix' || !/^[1-9][0-9]*$/.test(String(job.job_id))) continue;
    const frozen = job.input as { source_node_id?: unknown; inputs?: unknown; output_format?: unknown } | null;
    if (!frozen || typeof frozen.source_node_id !== 'string' || !Array.isArray(frozen.inputs)
      || !AUDIO_MIX_FORMATS.includes(frozen.output_format as AudioMixFormat)) continue;
    const jobId = String(job.job_id);
    const nodeId = audioMixNodeId(jobId);
    let card = nextNodes.find((node) => node.id === nodeId);
    if (!card && job.canvas_card_state === 'pending') {
      const source = nextNodes.find((node) => node.id === frozen.source_node_id);
      const anchor = source ?? nextNodes[0];
      const position = anchor ? findAudioMixPosition(anchor, [...occupied, ...nextNodes]) : { x: 0, y: 0 };
      card = buildAudioMixPlaceholderNode(jobId, frozen.output_format as AudioMixFormat, position);
      nextNodes = [...nextNodes, card];
      pollJobIds.push(jobId);
    }
    if (!card) continue;
    if ((job.status === 'queued' || job.status === 'processing') && card.data.genStatus !== 'generating') {
      nextNodes = nextNodes.map((node) => node.id === nodeId
        ? { ...node, data: { ...node.data, genStatus: 'generating', progress: job.progress, errorText: undefined } }
        : node);
      pollJobIds.push(jobId);
    } else if ((job.status === 'failed' && card.data.genStatus !== 'failed')
      || (job.status === 'succeeded' && card.data.genStatus != null)) {
      pollJobIds.push(jobId);
    }
    const liveIds = new Set(nextNodes.map((node) => node.id));
    for (const input of frozen.inputs) {
      const sourceId = (input as { node_id?: unknown } | null)?.node_id;
      if (typeof sourceId !== 'string' || !liveIds.has(sourceId) || sourceId === nodeId) continue;
      if (nextEdges.some((edge) => edge.source === sourceId && edge.target === nodeId)) continue;
      nextEdges = [...nextEdges, {
        id: `audio-mix-edge-${sourceId}-${jobId}`,
        source: sourceId, target: nodeId, type: 'custom',
        style: { stroke: '#444' }, data: { origin: AUDIO_MIX_EDGE_ORIGIN },
      }];
    }
  }
  return { nodes: nextNodes, edges: nextEdges, pollJobIds: [...new Set(pollJobIds)] };
}

export function audioMixTerminalPatch(detail: {
  status: string;
  asset?: { id?: string; url?: string; duration?: number | null } | null;
  error?: { msg?: string; message?: string } | null;
}): Record<string, unknown> | null {
  if (detail.status === 'succeeded') {
    if (!detail.asset?.id || !detail.asset.url) return { genStatus: 'failed', errorText: '混合结果资产不可用' };
    return {
      genStatus: undefined,
      progress: 100,
      src: detail.asset.url,
      mediaType: 'audio',
      assetId: detail.asset.id,
      ...(detail.asset.duration != null ? { duration: detail.asset.duration } : {}),
    };
  }
  if (detail.status === 'failed') {
    return { genStatus: 'failed', errorText: detail.error?.msg ?? detail.error?.message ?? '音频混合失败' };
  }
  if (detail.status === 'cancelled') return { genStatus: 'cancelled' };
  return null;
}
