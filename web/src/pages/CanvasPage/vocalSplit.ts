/* ============================================
 * 人声背景分离（IKHA2W 编辑会话/占位卡 + IKHA30 成功轨卡扇出）纯逻辑（无 React 依赖，
 * 形状对齐 mediaExtract.ts / audioVideoSplit.ts 家族先例）。场景四档与格式五档
 * 经 @lib/contracts/vocal-split 与契约同源（禁止在前端硬编码枚举）；轨数映射
 * 由契约 VOCAL_SPLIT_SCENE_TRACKS 单源（audio/music → 人声+背景音两轨、
 * drama/narrate → 人声/音乐/音效三轨），展示 hint 从轨数组派生。
 * ============================================ */

import {
  VOCAL_SPLIT_DEFAULT_OUTPUT_FORMAT,
  VOCAL_SPLIT_DEFAULT_SCENE,
  VOCAL_SPLIT_OUTPUT_FORMATS,
  VOCAL_SPLIT_SCENE_TRACKS,
  VOCAL_SPLIT_SCENES,
  type VocalSplitOutputFormat,
  type VocalSplitScene,
  type VocalSplitTrackType,
} from '@lib/contracts/vocal-split';
import { readJobFailText } from '@/api/jobs';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';

/* ============ 会话参数（契约同源引用，出处见头注释） ============ */

// 契约常量再导出供组件/页面消费（对齐 audioVideoSplit.ts 再导出先例）。
export const VOCAL_SPLIT_FORMATS = VOCAL_SPLIT_OUTPUT_FORMATS;
export type VocalSplitFormat = VocalSplitOutputFormat;
export type { VocalSplitScene };
export const VOCAL_SPLIT_DEFAULT_FORMAT: VocalSplitFormat = VOCAL_SPLIT_DEFAULT_OUTPUT_FORMAT;

export const VOCAL_SPLIT_SCENE_OPTIONS: readonly VocalSplitScene[] = VOCAL_SPLIT_SCENES;
export const VOCAL_SPLIT_DEFAULT_SESSION_SCENE: VocalSplitScene = VOCAL_SPLIT_DEFAULT_SCENE;

/** 场景中文标签（官方 Audio/Music/Drama/Narrate 的产品语义：通用/音乐/短剧/口播）。 */
export function vocalSplitSceneLabel(scene: VocalSplitScene): string {
  const labels: Record<VocalSplitScene, string> = {
    audio: '通用',
    music: '音乐',
    drama: '短剧',
    narrate: '口播',
  };
  return labels[scene];
}

/** 产出轨数说明（下拉项 hint）：两轨场景「人声+背景音两轨」、三轨场景「人声/音乐/音效三轨」；
 *  轨集合由契约 VOCAL_SPLIT_SCENE_TRACKS 派生，不在 UI 层另写映射。 */
export function vocalSplitSceneHint(scene: VocalSplitScene): string {
  const tracks = VOCAL_SPLIT_SCENE_TRACKS[scene];
  return tracks.length >= 3 ? '人声/音乐/音效三轨' : '人声+背景音两轨';
}

/* ============ 占位卡身份与命名 ============ */

/** 人声背景分离占位节点 id 前缀：`vocal-split-{jobId}`（家族 media-extract-{job_id} 对齐形态）。 */
export const VOCAL_SPLIT_NODE_PREFIX = 'vocal-split-';

/** 人声背景分离来源边标记（写在 edge.data.origin）：这条边表达「该占位卡的音频轨取自
 *  那段视频」，是来源记录而非生成参考输入——参考推导（audioMediaRefsOf）跳过带此标记
 *  的边，防止源视频被当成非法音频参考卡住发送（同 media-extract 先例）。 */
export const VOCAL_SPLIT_EDGE_ORIGIN = 'vocal-split';

/** 音频占位节点与源视频节点右边缘的间距（家族「节点宽 + 60」口径里的 60，同 media-extract）。 */
export const VOCAL_SPLIT_NODE_GAP = 60;

/** 人声背景分离结果卡身份标记（node.data.vocalSplit，形态对齐 MediaExtractIdentity）：
 *  失败重试按 lastInput（源素材 + 场景 + 格式）原样重发创建接口。 */
export interface VocalSplitIdentity {
  /** 源素材身份（assetId 归一字符串）：提交冻结 source_asset_id */
  sourceAssetId: string;
  /** 上次提交参数；失败重试原样重发（场景与格式随任务冻结，不做跨会话记忆） */
  lastInput: { source_asset_id: string; scene: VocalSplitScene; output_format: VocalSplitFormat };
}

export function vocalSplitNodeId(jobId: string | number): string {
  return `${VOCAL_SPLIT_NODE_PREFIX}${jobId}`;
}

export function isVocalSplitNodeId(id: string): boolean {
  return id.startsWith(VOCAL_SPLIT_NODE_PREFIX);
}

/** 占位卡展示名：源视频文件名去扩展名 + 「(人声背景分离)」；产物是多轨音频（扇出归
 *  IKHA30 逐轨命名），占位期名字不带格式后缀。空名回落「人声背景分离」。 */
export function vocalSplitDisplayName(videoFileName: unknown): string {
  const name = typeof videoFileName === 'string' ? videoFileName.trim() : '';
  if (!name) return '人声背景分离';
  return `${name.replace(/\.[^./]+$/, '')}(人声背景分离)`;
}

/** 人声背景分离占位节点（IKHA2W，形态照 buildMediaExtractPlaceholderNode）：发送后本地插入
 *  源视频节点右侧，genStatus=generating + jobId + mediaType audio + vocalSplit 身份（失败重试
 *  按 lastInput 原样重发），后续由轮询终态收敛、自动保存落盘——成功扇出（移除占位卡建轨卡）
 *  见本文件 buildVocalSplitTrackNodes（IKHA30）。横向位置按源节点实际内容宽 + 家族间距 60
 *  让开一格（扇出锚点继承本位置）。 */
export function buildVocalSplitPlaceholderNode(input: {
  jobId: string | number;
  scene: VocalSplitScene;
  outputFormat: VocalSplitFormat;
  sourceAssetId?: string | number | null;
  source?: { position?: { x?: number; y?: number }; data?: Record<string, unknown> } | null;
}): {
  id: string;
  type: 'mediaNode';
  position: { x: number; y: number };
  data: Record<string, unknown>;
} {
  const x = Number(input.source?.position?.x ?? 0);
  const y = Number(input.source?.position?.y ?? 0);
  const data = input.source?.data ?? {};
  const box = mediaContentBox({
    mediaType: data.mediaType as 'image' | 'video' | 'audio' | undefined,
    width: typeof data.width === 'number' ? data.width : undefined,
    height: typeof data.height === 'number' ? data.height : undefined,
    ratio: typeof data.targetRatio === 'string' ? data.targetRatio : undefined,
  });
  const sourceAssetId =
    input.sourceAssetId != null ? String(input.sourceAssetId) : '';
  const left = Number.isFinite(x) ? x : 0;
  const top = Number.isFinite(y) ? y : 0;
  return {
    id: vocalSplitNodeId(input.jobId),
    type: 'mediaNode',
    position: {
      x: Math.round(left + box.width + VOCAL_SPLIT_NODE_GAP),
      y: Math.round(top),
    },
    data: {
      src: '',
      fileName: vocalSplitDisplayName(data.fileName),
      mediaType: 'audio',
      genStatus: 'generating',
      progress: 0,
      jobId: input.jobId,
      toolMode: 'select',
      // 身份标记：仅 sourceAssetId 已知时携带（失败重试按 lastInput 原样重发；形态同家族 lastInput 先例）
      ...(sourceAssetId
        ? { vocalSplit: { sourceAssetId, lastInput: { source_asset_id: sourceAssetId, scene: input.scene, output_format: input.outputFormat } } }
        : {}),
    },
  };
}

/* ============ 错误文案与终态补丁 ============ */

const ERROR_CODE_TEXT: Record<string, string> = {
  vocal_split_failed: '人声背景分离失败，请重试',
  source_asset_unavailable: '源视频资产不可用，请刷新画布后重试',
  enqueue_failed: '任务入队失败，请重试',
};

export function vocalSplitErrorText(
  error?: { code?: string | number; message?: string; msg?: string } | null,
): string {
  const text = readJobFailText(error);
  if (text) return text;
  if (error?.code != null && ERROR_CODE_TEXT[String(error.code)]) {
    return ERROR_CODE_TEXT[String(error.code)];
  }
  return '人声背景分离失败';
}

/** 人声背景分离任务终态的本地节点补丁；进行中返回 null，调用方继续轮询。
 *  成功不再落本卡补丁（IKHA30）：succeeded 返回 null，由调用方在调本函数前先行接管——
 *  移除占位卡 + 按 tracks 扇出轨卡（buildVocalSplitTrackNodes，一对多骨架首例）。
 *  本函数只收敛 failed（可读文案 + 重试）与 cancelled。 */
export function vocalSplitTerminalPatch(detail: {
  status: string;
  error?: { code?: string | number; message?: string; msg?: string } | null;
}): Record<string, unknown> | null {
  if (detail.status === 'failed') {
    return {
      genStatus: 'failed',
      errorText: vocalSplitErrorText(detail.error),
    };
  }
  if (detail.status === 'cancelled') {
    return { genStatus: 'cancelled' };
  }
  return null;
}

/* ============ 成功轨卡扇出（IKHA30，本仓一对多扇出骨架首例） ============ */
/* 骨架边界：本节把「逐轨命名 + 确定性轨卡 id + 扇出布局」收成纯函数；页面层（index.tsx
 * fanOutVocalSplitTracks）只做副作用接线（移除占位卡、attachCallbacks、拉来源边、落库）。
 * 场景切分（ADR-0108）复用时改的是「轨数组来源与逐卡 data 投影」，本节函数形态可直接对齐。 */

/** 轨类型中文词（轨卡命名括号词；语义出处 = 契约 VOCAL_SPLIT_TRACK_TYPES 注释的
 *  官方输出音轨列：voice 人声 / background 背景音 / music 音乐 / sfx 音效）。 */
export const VOCAL_SPLIT_TRACK_LABELS: Record<VocalSplitTrackType, string> = {
  voice: '人声',
  background: '背景音',
  music: '音乐',
  sfx: '音效',
};

/** 轨卡节点 id 前缀：`vocal-track-{jobId}-{track_type}`。**刻意不带 vocal-split- 前缀**：
 *  占位卡判定 isVocalSplitNodeId 是 startsWith('vocal-split-')，轨卡若命名
 *  `vocal-split-{jobId}-{track}` 会被误判成占位卡。id 确定性（同任务同轨恒同 id）
 *  是扇出幂等的基础：重复终态/重复水合按 id 判重，不重复建卡。 */
export const VOCAL_SPLIT_TRACK_NODE_PREFIX = 'vocal-track-';

export function vocalSplitTrackNodeId(
  jobId: string | number,
  trackType: VocalSplitTrackType,
): string {
  return `${VOCAL_SPLIT_TRACK_NODE_PREFIX}${jobId}-${trackType}`;
}

/** 从占位卡展示名还原源名（去掉 buildVocalSplitPlaceholderNode 写入的「(人声背景分离)」
 *  后缀）；非本家族名字（用户改过名等）返回空串，命名回落交给 vocalSplitTrackDisplayName。 */
export function vocalSplitSourceName(placeholderFileName: unknown): string {
  const name = typeof placeholderFileName === 'string' ? placeholderFileName.trim() : '';
  const suffix = '(人声背景分离)';
  if (!name.endsWith(suffix)) return '';
  return name.slice(0, name.length - suffix.length).trim();
}

/** 轨卡展示名：`源名(轨词).格式`——两轨场景 = 源名(人声|背景音).格式、三轨场景 =
 *  源名(人声|音乐|音效).格式（轨词随 track_type、后缀随所选格式）；源名缺失回落
 *  「人声背景分离(轨词).格式」。命名机制先例 audioDisplayName（mediaExtract.ts）。 */
export function vocalSplitTrackDisplayName(
  sourceName: unknown,
  trackType: VocalSplitTrackType,
  format: VocalSplitFormat,
): string {
  const base = typeof sourceName === 'string' ? sourceName.trim() : '';
  const label = VOCAL_SPLIT_TRACK_LABELS[trackType];
  if (!base) return `人声背景分离(${label}).${format}`;
  return `${base}(${label}).${format}`;
}

/** 扇出计划单项：轨类型（调用方据此拉来源边）+ 轨卡节点形状（attachCallbacks 后即可落画布）。 */
export interface VocalSplitTrackNodePlan {
  trackType: VocalSplitTrackType;
  node: {
    id: string;
    type: 'mediaNode';
    position: { x: number; y: number };
    data: Record<string, unknown>;
  };
}

/** 扇出计划（一对多骨架纯函数）：按任务结果 tracks 顺序（后端保证恒 = 契约
 *  VOCAL_SPLIT_SCENE_TRACKS[scene]，voice 恒首轨）在锚点右列纵向排布 N 张**普通音频
 *  成品卡**——横向同列，纵向步长 = 轨卡内容区高(240) + 家族间距 60。锚点传占位卡实时
 *  位置：占位卡建卡时已按源卡实际内容宽让位（buildVocalSplitPlaceholderNode），拖动后
 *  跟随现场，扇出顶替占位卡列位。轨卡 data 形态对齐 media-extract 成功回填（src/
 *  assetId/duration），不写 jobId 不写 genStatus——水合不会为轨卡开轮询。 */
export function buildVocalSplitTrackNodes(input: {
  jobId: string | number;
  outputFormat: VocalSplitFormat;
  tracks: ReadonlyArray<{
    track_type: VocalSplitTrackType;
    asset_id: string;
    url: string;
    duration: number | null;
  }>;
  /** 源名（vocalSplitSourceName 还原结果；空回落「人声背景分离」前缀） */
  sourceName: string;
  /** 扇出锚点（占位卡实时位置） */
  anchor: { x: number; y: number };
}): VocalSplitTrackNodePlan[] {
  const box = mediaContentBox({ mediaType: 'audio' });
  const left = Number.isFinite(input.anchor.x) ? input.anchor.x : 0;
  const top = Number.isFinite(input.anchor.y) ? input.anchor.y : 0;
  return input.tracks.map((track, index) => ({
    trackType: track.track_type,
    node: {
      id: vocalSplitTrackNodeId(input.jobId, track.track_type),
      type: 'mediaNode' as const,
      position: {
        x: Math.round(left),
        y: Math.round(top + index * (box.height + VOCAL_SPLIT_NODE_GAP)),
      },
      data: {
        // 普通音频成品卡（零样式改动）：可播放、可下载入库、可 @、可再作其他工具输入
        src: track.url,
        fileName: vocalSplitTrackDisplayName(input.sourceName, track.track_type, input.outputFormat),
        mediaType: 'audio',
        progress: 100,
        assetId: track.asset_id,
        ...(track.duration != null ? { duration: track.duration } : {}),
        toolMode: 'select',
      },
    },
  }));
}
