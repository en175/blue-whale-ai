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
