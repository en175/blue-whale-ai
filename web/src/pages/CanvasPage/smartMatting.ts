/* ============================================
 * 视频智能抠像（IKHK7N 入口门槛 / IKHK9N 编辑态与发送闭环）：「智能抠像 ▾」入口
 * 门槛预检、双模式枚举与菜单文案（纯逻辑，无 React 依赖，形状与判定口径对齐
 * sceneSplit.ts / audioVideoSplit.ts 先例）。
 * 时长 10 分钟上限出处 = ADR-0112（对齐智能去字幕的 10 分钟置灰：官方处理耗时为
 * 视频时长的 1~3 倍而 worker 轮询窗口约 60 分钟，不拦等于让长视频注定超时失败）；
 * 分辨率与输入格式不做前置拦截（官方支持 mp4/flv/ts/avi/mov/mkv/wmv 等主流格式，
 * 超限与不受支持均由任务失败口径兜底）。
 * ============================================ */

import {
  VIDEO_MATTING_BACKGROUND_COLORS,
  VIDEO_MATTING_DEFAULT_BACKGROUND_COLOR,
  VIDEO_MATTING_DEFAULT_FORMAT,
  VIDEO_MATTING_FORMATS,
  type VideoMattingBackgroundColor,
  type VideoMattingFormat,
} from '@lib/contracts/video-matting';
import { readJobFailText } from '@/api/jobs';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';

/** 入口可用态悬停说明（效果边界，对齐家族 ENTRY_HINT 口径） */
export const SMART_MATTING_ENTRY_HINT = '识别人物或绿幕主体并移除背景，输出透明/纯色视频';

/** 置灰原因一（同场景切分：视频未关联资产时入口不可用） */
export const SMART_MATTING_MISSING_ASSET_REASON = '当前视频尚未关联资产，无法智能抠像';

/** 10 分钟时长上限（秒）：时长超限且有数据时置灰；恰好 600 放行（超限才拦） */
export const SMART_MATTING_MAX_DURATION_SECONDS = 600;

/** 置灰原因二：时长超 10 分钟且有时长数据（时长缺失不判，由后端按权威数据复核） */
export const SMART_MATTING_OVER_DURATION_REASON = '视频超过 10 分钟，暂不支持智能抠像';

/** 门槛判定输入：与 MediaNode data 字段同名（assetId 视频关联资产 id，duration 时长秒）。 */
export interface SmartMattingGateSource {
  assetId?: string | number | null;
  duration?: number;
}

/** 「智能抠像」入口门槛预检（按钮置灰用）：返回不可用原因（悬停展示），null 为可用。
 *  置灰条件两条 = 视频未关联资产；时长超 10 分钟（>600s）且有时长数据。
 *  时长数据缺失（null/undefined，存量数据）放行不拦，由后端按权威数据复核；
 *  分辨率与输入格式不做前置拦截（超限走任务失败口径兜底）。 */
export function smartMattingGateReason(source: SmartMattingGateSource): string | null {
  if (source.assetId == null) return SMART_MATTING_MISSING_ASSET_REASON;
  if (
    typeof source.duration === 'number'
    && source.duration > SMART_MATTING_MAX_DURATION_SECONDS
  ) {
    return SMART_MATTING_OVER_DURATION_REASON;
  }
  return null;
}

/* ============ 抠像模式（ADR-0112：模式前置到入口下拉） ============ */

/** 抠像模式（ADR-0112：双模式对齐火山 matte-portrait-video / matte-greenscreen-video
 *  两端点）：入口菜单两项各进一种会话，会话内不互切（换模式 = 退出后从菜单重选，
 *  去字幕家族口径）；触发钮点击直启首项「人像抠像」（portrait）。 */
export type SmartMattingMode = 'portrait' | 'greenscreen';

/** 首项「人像抠像」菜单项悬停说明（工单验收：任意视频只识别人物主体） */
export const SMART_MATTING_PORTRAIT_HINT = '任意视频，自动识别人物主体';

/** 次项「绿幕抠像」菜单项悬停说明（工单验收：绿幕/纯色背景素材，主体可为人、物品、动物） */
export const SMART_MATTING_GREENSCREEN_HINT = '绿幕/纯色背景素材，主体可为人、物品、动物';

/* ============ 编辑态会话纯逻辑（IKHK9N）：输出格式 / 背景色 / 占位卡 / 失败文案 ============ */

// 契约常量再导出供外部消费（对齐 sceneSplit.ts / audioVideoSplit.ts 再导出先例）：格式与
// 背景色枚举、默认档只此一份（IKHK7F 契约），编辑态单条与占位卡冻结共用。
export const SMART_MATTING_FORMATS = VIDEO_MATTING_FORMATS;

export type SmartMattingFormat = VideoMattingFormat;

/** 缺省输出格式 WEBM 透明（契约同名常量；每次进入编辑态重置为本值、退出复位——
 *  格式与背景色都不跨会话记忆，工单验收口径）。 */
export const SMART_MATTING_DEFAULT_FORMAT: SmartMattingFormat = VIDEO_MATTING_DEFAULT_FORMAT;

export const SMART_MATTING_BACKGROUND_COLORS = VIDEO_MATTING_BACKGROUND_COLORS;

export type SmartMattingBackgroundColor = VideoMattingBackgroundColor;

/** 缺省背景色 white（契约同名常量——不采用官方两工具各异的绿幕合成默认，ADR-0112）。 */
export const SMART_MATTING_DEFAULT_BACKGROUND_COLOR: SmartMattingBackgroundColor =
  VIDEO_MATTING_DEFAULT_BACKGROUND_COLOR;

/** 输出格式下拉两档中文标签（触发钮与菜单项共用；仅 UI，枚举值进任务参数） */
export const SMART_MATTING_FORMAT_LABELS: Record<SmartMattingFormat, string> = {
  WEBM: 'WEBM 透明',
  MP4: 'MP4 纯色',
};

/** 背景色分段控件三档中文标签（仅 UI，枚举值进任务参数） */
export const SMART_MATTING_BACKGROUND_COLOR_LABELS: Record<SmartMattingBackgroundColor, string> = {
  white: '白色',
  black: '黑色',
  green: '绿色',
};

/** 模式 → 编辑态单条标题（跟随所选模式：换模式 = 退出后从入口菜单重选，ADR-0112） */
export const SMART_MATTING_MODE_LABELS: Record<SmartMattingMode, string> = {
  portrait: '人像抠像',
  greenscreen: '绿幕抠像',
};

/** 智能抠像来源边标记（写在 edge.data.origin）：占位卡由该视频发起抠像的来源记录，
 *  参考推导与 @ 编号跳过（口径同 SCENE_SPLIT_EDGE_ORIGIN / VIDEO_ENHANCE_EDGE_ORIGIN）。 */
export const SMART_MATTING_EDGE_ORIGIN = 'smart-matting';

/** 抠像任务占位卡与源视频卡右边缘的间距（沿用家族「节点宽 + 60」口径里的 60）。 */
export const SMART_MATTING_NODE_GAP = 60;

/** 占位卡展示名（标题跟随所选模式，规格所见即所得；成品卡回填归 IKHKAC） */
export function smartMattingDisplayName(mode: SmartMattingMode): string {
  return SMART_MATTING_MODE_LABELS[mode];
}

/** 抠像任务提交业务参数（契约 input 业务键形态）：WEBM（透明）不接受 background_color、
 *  MP4（纯色）必带——buildSmartMattingInput 是该形态的唯一构建点，编辑态发送与占位卡
 *  lastInput 冻结共用，防两处键形态漂移（strict 契约下 WEBM 误带键即 400）。 */
export interface SmartMattingParams {
  source_asset_id: string;
  target_node_id: string;
  mode: SmartMattingMode;
  format: SmartMattingFormat;
  /** 仅 format=MP4 时存在（契约 strict refine：WEBM 形态恒无本键） */
  background_color?: SmartMattingBackgroundColor;
}

/** 按所选格式构建提交业务参数（client_token 由调用侧每次新生成，不进本函数）。 */
export function buildSmartMattingInput(input: {
  sourceAssetId: string;
  targetNodeId: string;
  mode: SmartMattingMode;
  format: SmartMattingFormat;
  backgroundColor: SmartMattingBackgroundColor;
}): SmartMattingParams {
  return input.format === 'MP4'
    ? {
        source_asset_id: input.sourceAssetId,
        target_node_id: input.targetNodeId,
        mode: input.mode,
        format: input.format,
        background_color: input.backgroundColor,
      }
    : {
        source_asset_id: input.sourceAssetId,
        target_node_id: input.targetNodeId,
        mode: input.mode,
        format: input.format,
      };
}

/** 智能抠像占位卡身份标记（node.data.smartMatting，形态对齐 SceneSplitIdentity）：
 *  失败重试按 lastInput（源素材 + 占位卡绑定 + 模式/格式/背景色）原参数重发创建接口，
 *  client_token 由发送/重试调用侧每次新生成（不冻结进身份——同 token 只会重放旧任务）。 */
export interface SmartMattingIdentity {
  /** 源素材身份（assetId 归一字符串）：提交冻结 source_asset_id */
  sourceAssetId: string;
  /** 上次提交业务参数（target_node_id = 本占位卡节点 id，失败重试原地承接同卡） */
  lastInput: SmartMattingParams;
}

/** 智能抠像占位节点（IKHK9N）：发送前本地插入源视频右侧（target_node_id 发送时取本卡
 *  节点 id，先建卡后发请求——BO 定死流程），genStatus=generating 生成中骨架 + 模式标题
 *  展示名 + smartMatting 身份（失败重试原参数重发）；job_id 由创建响应写入；成品卡回填
 *  归 IKHKAC。横向位置按源节点实际内容宽让开一格，口径同 buildSceneSplitPlaceholderNode。 */
export function buildSmartMattingPlaceholderNode(input: {
  nodeId: string;
  mode: SmartMattingMode;
  sourceAssetId: string;
  lastInput: SmartMattingParams;
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
      x: Math.round(left + box.width + SMART_MATTING_NODE_GAP),
      y: Math.round(top),
    },
    data: {
      src: '',
      fileName: smartMattingDisplayName(input.mode),
      mediaType: 'video',
      genStatus: 'generating',
      progress: 0,
      toolMode: 'select',
      // 身份标记：失败重试按 lastInput 原参数重发（形态同家族 lastInput 先例）
      smartMatting: {
        sourceAssetId: input.sourceAssetId,
        lastInput: input.lastInput,
      } satisfies SmartMattingIdentity,
    },
  };
}

/** 智能抠像任务失败文案：优先服务端 msg（错误码 1049「智能抠像失败，请重试」已在
 *  error-codes 契约映射，经顶层 msg 透传），缺失时本地兜底同文案。 */
export function smartMattingErrorText(
  error?: { code?: string | number; message?: string; msg?: string } | null,
): string {
  return readJobFailText(error) || '智能抠像失败，请重试';
}
