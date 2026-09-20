/* ============================================
 * 场景切分（IKH8BJ 入口门槛 / IKH8BR 编辑态与任务卡）：「场景切分」入口门槛预检、
 * 效果边界文案、切分粒度三档与任务占位卡构建（纯逻辑，无 React 依赖，形状与判定
 * 口径对齐 audioVideoSplit.ts / videoSubtitleErase.ts 先例）。
 * 粒度三档枚举与默认档经 @lib/contracts/video-scene-split 与契约同源（对齐
 * audioVideoSplit.ts 契约常量引用先例）；完成扇出（段卡）由下一票 IKH8C1 交付。
 * ============================================ */

import {
  VIDEO_SCENE_SPLIT_DEFAULT_GRANULARITY,
  VIDEO_SCENE_SPLIT_GRANULARITIES,
  type VideoSceneSplitGranularity,
} from '@lib/contracts/video-scene-split';
import { readJobFailText } from '@/api/jobs';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';
import { overlaps, type SpawnBox } from './draftSpawn';

/** 入口可用态悬停说明（效果边界，对齐 audioVideoSplit ENTRY_HINT 家族口径） */
export const SCENE_SPLIT_ENTRY_HINT = '将视频按场景切分为多张片段卡片';

/** 置灰原因一（同音视频分离：视频未关联资产时入口不可用） */
export const SCENE_SPLIT_MISSING_ASSET_REASON = '当前视频尚未关联资产，无法场景切分';

/** 2 小时时长上限（秒）：时长超限且有数据时置灰；恰好 7200 放行（超限才拦） */
export const SCENE_SPLIT_MAX_DURATION_SECONDS = 7200;

/** 置灰原因二：时长超 2 小时且有时长数据（时长缺失不判，由后端按权威数据复核） */
export const SCENE_SPLIT_OVER_DURATION_REASON = '视频超过 2 小时，暂不支持场景切分';

/** 门槛判定输入：与 MediaNode data 字段同名（assetId 视频关联资产 id，duration 时长秒）。 */
export interface SceneSplitGateSource {
  assetId?: string | number | null;
  duration?: number;
}

/** 「场景切分」入口门槛预检（按钮置灰用）：返回不可用原因（悬停展示），null 为可用。
 *  置灰条件两条 = 视频未关联资产；时长超 2 小时（>7200s）且有时长数据。
 *  时长数据缺失（null/undefined，存量数据）放行不拦，由后端按权威数据复核；
 *  格式不做前置拦截（超限走任务失败口径兜底）。 */
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

/* ============ 切分粒度三档（IKH8BR，契约同源引用） ============ */

// 契约常量再导出供外部消费（对齐 audioVideoSplit.ts 再导出先例）；数值 5/10/20 由
// worker 出站换算（VIDEO_SCENE_SPLIT_SEGMENT_THRESHOLD），前端只传枚举。
export const SCENE_SPLIT_GRANULARITIES = VIDEO_SCENE_SPLIT_GRANULARITIES;

export type SceneSplitGranularity = VideoSceneSplitGranularity;

/** 缺省粒度档 standard（「默认标准」= 官方推荐经验值 10）。粒度不跨会话记忆——
 *  每次进入编辑态重置为本值、退出复位。 */
export const SCENE_SPLIT_DEFAULT_GRANULARITY: SceneSplitGranularity = VIDEO_SCENE_SPLIT_DEFAULT_GRANULARITY;

/** 粒度档中文标签（编辑态单条三档分段控件与占位卡粒度标注共用，仅 UI 不进任务参数）。 */
export const SCENE_SPLIT_GRANULARITY_LABELS: Record<SceneSplitGranularity, string> = {
  fine: '细',
  standard: '标准',
  coarse: '粗',
};

/** 场景切分来源边标记（写在 edge.data.origin）：这条边表达「占位卡由该视频发起切分」，
 *  是来源记录而非生成参考输入——参考推导与 @ 编号跳过带此标记的边（口径同
 *  VIDEO_ENHANCE_EDGE_ORIGIN / mediaExtract 来源边）。 */
export const SCENE_SPLIT_EDGE_ORIGIN = 'scene-split';

/** 场景切分卡与源视频卡右边缘的间距（沿用既有「节点宽 + 60」口径里的 60）。 */
export const SCENE_SPLIT_NODE_GAP = 60;

/** 占位卡展示名（标题「场景切分」+ 标注所选粒度档，规格故事 11 所见即所得）。 */
export function sceneSplitDisplayName(granularity: SceneSplitGranularity): string {
  return `场景切分 · ${SCENE_SPLIT_GRANULARITY_LABELS[granularity]}`;
}

/** 场景切分占位卡身份标记（node.data.sceneSplit，形态对齐 MediaExtractIdentity）：
 *  失败重试按 lastInput（源素材 + 占位卡节点 id + 所选粒度）原参数原粒度重发创建接口，
 *  client_token 由发送/重试调用侧每次新生成（不冻结进身份——同 token 只会重放旧任务）。 */
export interface SceneSplitIdentity {
  /** 源素材身份（assetId 归一字符串）：提交冻结 source_asset_id */
  sourceAssetId: string;
  /** 上次提交业务参数（target_node_id = 本占位卡节点 id，失败重试原地承接同卡） */
  lastInput: {
    source_asset_id: string;
    target_node_id: string;
    granularity: SceneSplitGranularity;
  };
}

/** 场景切分占位节点（IKH8BR）：发送前本地插入源视频右侧（target_node_id 发送时取本卡
 *  节点 id，先建卡后发请求——BO 定死流程），genStatus=generating 生成中骨架 + 粒度标注
 *  展示名 + sceneSplit 身份（失败重试原参数原粒度重发）；job_id 由创建响应写入（jobId 位，
 *  家族先例同款）；后续由轮询终态收敛、自动保存落库——画布只由前端写。
 *  横向位置按**源节点实际内容宽**（视频 280×比例）让开一格，口径同 buildMediaExtractPlaceholderNode。 */
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
      // 身份标记：失败重试按 lastInput 原参数原粒度重发（形态同家族 lastInput 先例）
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

/** 场景切分任务失败文案：优先服务端 msg（错误码 1046「场景切分失败，请重试」已在
 *  error-codes 契约映射，经顶层 msg 透传），缺失时本地兜底同文案。 */
export function sceneSplitErrorText(
  error?: { code?: string | number; message?: string; msg?: string } | null,
): string {
  return readJobFailText(error) || '场景切分失败，请重试';
}

/* ============ 完成扇出（IKH8C1）：段卡标注与网格避让布局（纯函数） ============ */

/** 秒 → 时钟标注：mm:ss（不足 1 小时，分秒两位补零）；≥1 小时 h:mm:ss（时不补零）。
 *  向下取整防 59.6s 进位溢出成 00:60。 */
function formatSceneSplitClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 段卡标题（IKH8C1）：「第 N 段 起止时间」，如「第 2 段 00:15-00:46」；
 *  起止任一 ≥1 小时用 h:mm:ss（如「第 1 段 1:00:05-1:01:15」）。
 *  segment_index 直接采用任务返回的段序号（契约 1 起），不本地重算。 */
export function sceneSplitSegmentLabel(
  segmentIndex: number,
  startTime: number,
  endTime: number,
): string {
  return `第 ${segmentIndex} 段 ${formatSceneSplitClock(startTime)}-${formatSceneSplitClock(endTime)}`;
}

/** 段卡网格内卡与卡间距（px）：网格紧凑排布，节点级避让间距沿用 SCENE_SPLIT_NODE_GAP。 */
export const SCENE_SPLIT_FANOUT_GRID_GAP = 24;

/** 网格避让扫描上限：y 方向上下各试这么多步、x 方向最多右移这么多轮，
 *  穷尽后回退理想位（画布无限大实际不可穷尽，防御兜底）。 */
const SCENE_SPLIT_FANOUT_MAX_Y_STEPS = 200;
const SCENE_SPLIT_FANOUT_MAX_X_ROUNDS = 50;

export interface SceneSplitFanoutLayoutInput {
  /** 锚点盒（源卡占位盒，flow 坐标，含标题余量）：网格从其右缘起排、垂直中心对齐 */
  anchor: SpawnBox;
  /** 段数 N（≥1，无上限；仅切出 1 段照常出 1 张） */
  count: number;
  /** 段卡占位盒（内容区 + 标题余量） */
  segmentSize: { width: number; height: number };
  /** 画布既有节点占位盒（调用方排除锚点卡与占位卡——二者不参与避让） */
  occupied: SpawnBox[];
}

/** 段卡网格扇出落位（IKH8C1，纯函数）：列数 = ceil(√N)，行数按需；整片网格放源卡
 *  右缘 + SCENE_SPLIT_NODE_GAP、与源卡垂直中心对齐；与画布既有节点重叠时按
 *  「上下平移 → 整体右移一列」扫描首个无重叠位（保持扇出在源卡右侧的语义），
 *  穷尽后回退理想位。返回 N 个节点 position（左上角，按段序——第 0 项在网格左上，
 *  逐行排布），与 occupied 及彼此均不重叠（GAP 口径复用 draftSpawn.overlaps）。 */
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

/** 段卡占位盒（IKH8C1）：视频内容区（宽高优先，缺失回退 280 方形）+ 标题余量 44，
 *  口径对齐 CanvasPage nodeBoxOf 的媒体节点分支。 */
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
