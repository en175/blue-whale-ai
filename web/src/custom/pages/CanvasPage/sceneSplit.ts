
import {
  VIDEO_SCENE_SPLIT_DEFAULT_GRANULARITY,
  VIDEO_SCENE_SPLIT_GRANULARITIES,
  type VideoSceneSplitGranularity,
} from '@lib/contracts/video-scene-split';
import { readJobFailText } from '@/custom/api/jobs';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';
import { overlaps, type SpawnBox } from './draftSpawn';

export const SCENE_SPLIT_ENTRY_HINT = '将视频按场景切分为多张片段卡片';

export const SCENE_SPLIT_MISSING_ASSET_REASON = '当前视频尚未关联资产，无法场景切分';

export const SCENE_SPLIT_MAX_DURATION_SECONDS = 7200;

export const SCENE_SPLIT_OVER_DURATION_REASON = '视频超过 2 小时，暂不支持场景切分';

export interface SceneSplitGateSource {
  assetId?: string | number | null;
  duration?: number;
}

export function sceneSplitGateReason(source: SceneSplitGateSource): string | null {
  if (source.assetId == null) return SCENE_SPLIT_MISSING_ASSET_REASON;
  if (
    typeof source.duration === 'number'
    && source.duration > SCENE_SPLIT_MAX_DURATION_SECONDS
  ) {
    return SCENE_SPLIT_OVER_DURATION_REASON;
  }
  return null;
}


export const SCENE_SPLIT_GRANULARITIES = VIDEO_SCENE_SPLIT_GRANULARITIES;

export type SceneSplitGranularity = VideoSceneSplitGranularity;

export const SCENE_SPLIT_DEFAULT_GRANULARITY: SceneSplitGranularity = VIDEO_SCENE_SPLIT_DEFAULT_GRANULARITY;

export const SCENE_SPLIT_GRANULARITY_LABELS: Record<SceneSplitGranularity, string> = {
  fine: '细',
  standard: '标准',
  coarse: '粗',
};

export const SCENE_SPLIT_EDGE_ORIGIN = 'scene-split';

export const SCENE_SPLIT_NODE_GAP = 60;

export function sceneSplitDisplayName(granularity: SceneSplitGranularity): string {
  return `场景切分 · ${SCENE_SPLIT_GRANULARITY_LABELS[granularity]}`;
}

export interface SceneSplitIdentity {
  sourceAssetId: string;
  lastInput: {
    source_asset_id: string;
    target_node_id: string;
    granularity: SceneSplitGranularity;
  };
}

export function buildSceneSplitPlaceholderNode(input: {
  nodeId: string;
  granularity: SceneSplitGranularity;
  sourceAssetId: string;
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
  const left = Number.isFinite(x) ? x : 0;
  const top = Number.isFinite(y) ? y : 0;
  return {
    id: input.nodeId,
    type: 'mediaNode',
    position: {
      x: Math.round(left + box.width + SCENE_SPLIT_NODE_GAP),
      y: Math.round(top),
    },
    data: {
      src: '',
      fileName: sceneSplitDisplayName(input.granularity),
      mediaType: 'video',
      genStatus: 'generating',
      progress: 0,
      toolMode: 'select',
      sceneSplit: {
        sourceAssetId: input.sourceAssetId,
        lastInput: {
          source_asset_id: input.sourceAssetId,
          target_node_id: input.nodeId,
          granularity: input.granularity,
        },
      } satisfies SceneSplitIdentity,
    },
  };
}

export function sceneSplitErrorText(
  error?: { code?: string | number; message?: string; msg?: string } | null,
): string {
  return readJobFailText(error) || '场景切分失败，请重试';
}


function formatSceneSplitClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function sceneSplitSegmentLabel(
  segmentIndex: number,
  startTime: number,
  endTime: number,
): string {
  return `第 ${segmentIndex} 段 ${formatSceneSplitClock(startTime)}-${formatSceneSplitClock(endTime)}`;
}

export const SCENE_SPLIT_FANOUT_GRID_GAP = 24;

const SCENE_SPLIT_FANOUT_MAX_Y_STEPS = 200;
const SCENE_SPLIT_FANOUT_MAX_X_ROUNDS = 50;

export interface SceneSplitFanoutLayoutInput {
  anchor: SpawnBox;
  count: number;
  segmentSize: { width: number; height: number };
  occupied: SpawnBox[];
}

export function sceneSplitFanoutLayout(
  input: SceneSplitFanoutLayoutInput,
): Array<{ x: number; y: number }> {
  const { anchor, count, segmentSize, occupied } = input;
  const n = Math.max(1, Math.floor(count));
  const w = segmentSize.width;
  const h = segmentSize.height;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.ceil(n / cols);
  const gridGap = SCENE_SPLIT_FANOUT_GRID_GAP;
  const stepX = w + gridGap;
  const stepY = h + gridGap;
  const gridHeight = rows * h + (rows - 1) * gridGap;
  const baseX = Math.round(anchor.x + anchor.width + SCENE_SPLIT_NODE_GAP);
  const baseY = Math.round(anchor.y + anchor.height / 2 - gridHeight / 2);

  const positionsAt = (x: number, y: number) =>
    Array.from({ length: n }, (_, i) => ({
      x: Math.round(x + (i % cols) * stepX),
      y: Math.round(y + Math.floor(i / cols) * stepY),
    }));

  const collides = (positions: Array<{ x: number; y: number }>) => {
    const boxes: SpawnBox[] = positions.map((p) => ({ x: p.x, y: p.y, width: w, height: h }));
    return occupied.some((o) => boxes.some((b) => overlaps(b, o)));
  };

  for (let xr = 0; xr <= SCENE_SPLIT_FANOUT_MAX_X_ROUNDS; xr += 1) {
    const x = baseX + xr * stepX;
    for (let yr = 0; yr <= SCENE_SPLIT_FANOUT_MAX_Y_STEPS; yr += 1) {
      const yOffsets = yr === 0 ? [0] : [yr * stepY, -yr * stepY];
      for (const dy of yOffsets) {
        const positions = positionsAt(x, baseY + dy);
        if (!collides(positions)) return positions;
      }
    }
  }
  return positionsAt(baseX, baseY);
}

export function sceneSplitSegmentBox(size: { width?: number | null; height?: number | null }): {
  width: number;
  height: number;
} {
  const box = mediaContentBox({
    mediaType: 'video',
    width: typeof size.width === 'number' ? size.width : undefined,
    height: typeof size.height === 'number' ? size.height : undefined,
  });
  return { width: box.width, height: box.height + 44 };
}
