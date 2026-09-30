/* ============================================
 * MediaNode 媒体节点：图片/视频/音频展示与操作手柄
 * 统一外部常驻标题 + 独立圆角内容主体
 * 内容区尺度：图片/视频按真实比例（短边 280、长边 ≤840），音频恒 480×240 横矩形
 * ============================================ */
import { useState, useCallback, useEffect, useRef } from 'react';
import { Handle, Position, useStore, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { Image, Video, AudioLines, ImageOff, Plus, Check, RefreshCw, ChevronDown, Clock, Film } from 'lucide-react';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import { isMediaExtractNodeId, type MediaExtractIdentity } from '../../mediaExtract';
import { isAudioTrimNodeId } from '../../audioTrim';
import { isAudioMixNodeId } from '../../audioMix';
import type { AudioVideoMuxIdentity } from '../../audioVideoMux';
import type { ImageEnhanceIdentity } from '../../imageEnhance';
import type { ImageCutoutIdentity } from '../../imageCutout';
import type { ImageCropIdentity } from '../../imageCrop';
import type { VideoEnhanceIdentity } from '../../videoEnhance';
import type { FrameInterpolationIdentity } from '../../frameInterpolation';
import type { MaskOp, MaskPoint } from '../../eraseMask';
import type { SubtitleBoxOp, SubtitleBoxPoint } from '../../subtitleEraseBoxes';
import type { VideoSubtitleEraseMode } from '../../videoSubtitleErase';
import type { SmartMattingMode } from '../../smartMatting';
import EraseMaskLayer from './EraseMaskLayer';
import SubtitleEraseBoxesLayer from './SubtitleEraseBoxesLayer';
import AudioTrimOverlay from './AudioTrimOverlay';
import AudioPlayer, { useAudioTrimSeekBridge } from './AudioPlayer';
import VideoPlayerControls, { toggleVideoPlayback } from './VideoPlayerControls';
import { commitCardName } from '../cardName';
import { mediaNodeFailHeadline } from './failHeadline';
import { isCanvasToolGeneration, mediaNodeGenerationOverlay } from './generationOverlay';
import { mediaContentBox, type MediaDims } from './mediaContentSize';
import { HOVER_PREVIEW_DELAY_MS, videoHoverPreviewBlocked, videoHoverPreviewEligible } from './hoverPreview';
import { isMultiNodeSelection } from '../../useSoloNodeSelected';
import { nodeTitleSizing } from '../nodeTitleSizing';
import CanvasContextMenu from '../CanvasContextMenu';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/utils/remoteImageCors';
import styles from './index.module.css';

/** 连接点统一样式：透明背景（加号图标由 children 渲染） */
const HANDLE_STYLE = { background: 'transparent', border: 'none', width: 24, height: 24 } as const;

/** 加号连接点图标（ReactFlow Handle 的 children，替代默认圆点） */
function HandlePlus() {
  return (
    <span className="nodrag nopan" style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 24,
      height: 24,
      borderRadius: '50%',
      background: '#2a2a2a',
      border: '1px solid #555',
      color: '#ccc',
      boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
    }}>
      <Plus size={14} strokeWidth={2.5} />
    </span>
  );
}

/** 真实时长文案（秒取整）；未知或非正返回空串，标题右侧据此留空 */
const durationLabel = (duration?: number) =>
  typeof duration === 'number' && duration > 0 ? `${Math.round(duration)}s` : '';

/** 画面区点击判定位移阈值（像素）：按下到松开位移不超过它才算点击，超过视为拖动整卡 */
const VIDEO_CLICK_SLOP_PX = 6;

/** 画面区点击判定（IKI5YM）：按下坐标到松开坐标位移超阈值即拖动整卡，不算点击。
 *  树内 video 走 React 合成事件、收养会话元素走命令式原生监听——两端共用同一条判定 */
function isVideoClickSlop(press: { x: number; y: number }, clientX: number, clientY: number) {
  const dx = clientX - press.x;
  const dy = clientY - press.y;
  return dx * dx + dy * dy > VIDEO_CLICK_SLOP_PX ** 2;
}

/** 正在等首帧 seeked 的 video，避免 loadedmetadata / loadeddata / effect 叠监听 */
const pendingFirstFrameSeek = new WeakSet<HTMLVideoElement>();

/** IKJ7UI：样片截止时间显示（本地时区，分钟精度，MM-DD HH:mm 对齐 v3 原型角标口径）；
 *  无效/缺失返回空串（角标按「已过期」降级，见 ADR-0119「缺可信截止视同过期」）。 */
function sampleDeadlineLabel(at?: string | null): string {
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** IKIZQB：样片转成片是否已过期（按实际截止时间；无效时间不判过期）。 */
export function sampleDeadlineExpired(at?: string | null): boolean {
  if (!at) return false;
  const d = new Date(at);
  return !Number.isNaN(d.getTime()) && Date.now() > d.getTime();
}

/** 生成 MP4 常把 moov 放在文件尾，preload=metadata 只拿到时长，画面停在黑底。
 *  暂停时微调 currentTime 逼解码器吐出一帧；解码完成（seeked）再回调回填宽高。 */
function paintVideoFirstFrame(
  video: HTMLVideoElement | null,
  onSeeked?: (video: HTMLVideoElement) => void,
) {
  if (!video) return;
  if (video.readyState < 1) return;
  if (!video.paused) return;
  const duration = video.duration;
  const epsilon = Number.isFinite(duration) && duration > 0 ? Math.min(0.04, duration / 4) : 0.04;
  if (video.currentTime >= epsilon) {
    onSeeked?.(video);
    return;
  }
  if (pendingFirstFrameSeek.has(video)) return;
  pendingFirstFrameSeek.add(video);
  const handleSeeked = () => {
    pendingFirstFrameSeek.delete(video);
    video.removeEventListener('seeked', handleSeeked);
    onSeeked?.(video);
  };
  video.addEventListener('seeked', handleSeeked, { once: true });
  try {
    video.currentTime = epsilon;
  } catch {
    pendingFirstFrameSeek.delete(video);
    video.removeEventListener('seeked', handleSeeked);
  }
}

/** 生成状态（IKDMQQ 起含 draft；IKIZQE 增 checking）：draft 待生成草稿；generating 进度
 *  展示；checking 提交结果不明核对锁定（IKIZQD——不重发不退款，等轮询定夺）；
 *  failed/cancelled 错误展示；无值为普通媒体 */
export type MediaGenStatus = 'draft' | 'generating' | 'checking' | 'failed' | 'cancelled';

/** <video> 双源列表项：type 带 codecs 时浏览器才能精确判定解码能力 */
export interface VideoSourceOption {
  src: string;
  type: string;
}

/** 双源列表：主源编码未知不标 codecs（canPlayType 至少 "maybe" 被选中，解码失败浏览器
 *  自动落到次选）；H.264 兜底标 avc1。次选与主源相同则去重。 */
export function videoSourceList(src?: string, srcH264?: string): VideoSourceOption[] {
  const list: VideoSourceOption[] = [];
  if (src) list.push({ src, type: 'video/mp4' });
  if (srcH264 && srcH264 !== src) list.push({ src: srcH264, type: 'video/mp4; codecs="avc1"' });
  return list;
}

/** 视频加载失败文案（MediaError.code 分类；HTMLMediaElement.error 见各平台实现） */
export function videoLoadErrorMessage(code?: number): string {
  switch (code) {
    case 4: return '浏览器不支持该视频编码，请更换浏览器';
    case 3: return '视频解码失败';
    case 2: return '视频加载失败';
    default: return '视频无法播放';
  }
}

/** 媒体节点 data 契约（IKGYYD 起悬浮工具条迁出为 MediaNodeToolbar，本接口供其与 CanvasPage 共用） */
export interface MediaNodeData {
  src?: string;
  /** H.264 兜底地址（双源播放）：生成 MP4 编码未知（较长产物可能为 H.265/HEVC，
   *  Windows/Edge 无 HEVC 解码扩展时黑屏），提供时渲染为 <source> 次选——主源解码
   *  失败浏览器自动回退次选。后端转码落地前可选缺失，缺省行为与单源一致。 */
  srcH264?: string;
  fileName?: string;
  mediaType?: 'image' | 'video' | 'audio';
  toolMode?: 'drag' | 'select';
  isFirst?: boolean;
  /** 关联生成任务ID（生成中的占位节点）。后端返回字符串，兼容 number 历史形态。 */
  jobId?: number | string;
  /** 生成状态：见 MediaGenStatus */
  genStatus?: MediaGenStatus;
  /** 音频混合结果卡删除后，等待任务取消终态。 */
  audioMixCancelPending?: boolean;
  /** 草稿身份标记（IKDMQQ）：待生成/生成中/失败的草稿卡均为 true；成功后清除转为普通成品卡 */
  draft?: boolean;
  /** 草稿持久化参数（IKDMQQ）：面板编辑实时写回，随画布保存恢复 */
  draftModelId?: string;
  draftSize?: string;
  draftRatio?: string;
  /** IKIZQB：视频阶段身份（契约 videoStageSchema 投影）。sample = 样片卡（成功态在视频
   *  画面内右上角挂「样片 480P · 截止 MM-DD HH:mm」角标，过期/缺截止转警告橙——IKJ7UI
   *  迁入画面内）；final = 成片卡（IKIZQE——100% 普通视频卡体验，仅画面内「成片 1080P」
   *  角标）。 */
  videoStage?: 'sample' | 'final';
  /** 样片的实际转成片截止时间（RFC3339，服务端 finalize_deadline_at 投影回填）；
   *  null = 缺可信上游 created_at（禁用成片，样片仍保留）。过期只改警告色，不删除样片。 */
  finalizeDeadlineAt?: string | null;
  /** IKIZQE：成片卡来源关系——指向来源样片任务 ID（建卡时本地写入，成功终态按服务端
   *  source_sample_job_id 投影回填为权威）。样片卡据此找到自己的成片卡（两卡关系）。 */
  sourceSampleJobId?: string;
  /** IKIZQE：阶段费用状态（契约 chargeStateSchema 投影回填）——settled 配 actualCredits
   *  在角标注明已用积分；released 在失败卡注明预扣已退回。 */
  chargeState?: 'held' | 'settled' | 'released';
  actualCredits?: number | null;
  /** IKIZQE：样片卡标题行成片按钮（唯一链式入口）的渲染期派生状态——CanvasPage 注入，
   *  不持久化。phase：ready 可提交（credits 为成片预计积分）；loading 报价中；running
   *  成片生成中（占位卡受理前后同态）；checking 状态核对中（禁止再次点击）；expired
   *  过期/缺可信截止（IKJ7UI：整钮不渲染，过期信息由画面内角标表达）；unavailable
   *  无报价或已有成片尝试。 */
  finalizeCta?: {
    phase: 'ready' | 'loading' | 'running' | 'checking' | 'expired' | 'unavailable';
    credits?: number;
  };
  /** IKIZQE：样片卡标题行「生成 1080P 成片」点击派发（CanvasPage 承接提交链路） */
  onFinalizeSample?: (id: string) => void;
  /** IKIZQG：重新生成样片入口（成片失败卡失败区，IKJ7UI 起改形为同款「重试」按钮；
   *  过期样片卡标题行入口已随 ADR-0119 移除）的渲染期派生状态——CanvasPage 注入，
   *  不持久化。phase：ready 可提交（credits 为新样片预计积分）；loading 报价中；
   *  checking 上次提交结果不明核对中（禁止再次点击）；unavailable 无报价。 */
  regenerateCta?: {
    phase: 'ready' | 'loading' | 'checking' | 'unavailable';
    credits?: number;
  };
  /** IKIZQG：「重新生成样片」点击派发（CanvasPage 承接报价门控提交链路，新建卡不覆盖旧结果） */
  onRegenerateSample?: (id: string) => void;
  /** 高清身份标记（IKGM9F）：本卡由「高清放大」入口创建；「重新编辑」据此分流高清面板（IKGM9O） */
  imageEnhance?: ImageEnhanceIdentity;
  /** 视频 HD 高清身份标记（IKH3VG）：本卡由视频卡工具条「HD」入口创建；点卡与「重新编辑」
   *  据此分流 HD 面板（不进视频生成面板），lastParams 随面板切换即时写卡 */
  videoEnhance?: VideoEnhanceIdentity;
  /** 视频插帧身份标记（IKHLKR）：本卡由「高清 ▾」下拉第二项创建；点卡据此分流插帧面板
   *  （不进视频生成面板），lastParams.fps 随面板切换即时写卡并同步卡名 */
  frameInterpolation?: FrameInterpolationIdentity;
  /** 抠图身份标记（IKGXMT）：本卡由「抠图」结果链创建（建卡时随 data 持久化）——成品内容区
   *  据此垫棋盘格底纹（透明 png 可辨识，规格故事 21）；lastInput 供失败重试原样重发创建接口 */
  imageCutout?: ImageCutoutIdentity;
  /** 裁切身份标记：本卡由「裁切」结果链创建（客户端裁切无服务端任务）。成品态仍需渲染
   *  左侧 target Handle 接收来源边，故以本标记识别为生成宿主（非草稿占位，图片正常展示）。 */
  imageCrop?: ImageCropIdentity;
  /** 生成进度 0-100 */
  progress?: number;
  /** 失败原因 */
  errorText?: string;
  /** 生成时的提示词（「重新编辑」带回图片对话框） */
  prompt?: string;
  /** 资产 ID（上传完成后存储） */
  assetId?: string | number;
  /** 已绑定的素材库 id（asset- 前缀），用于入库去重 */
  materialId?: string;
  /** 空壳占位：待用户上传，不连线不成组无右键 */
  emptyShell?: boolean;
  /** 合规校验进行中（会话内 UI，不随画布持久化） */
  complianceBusy?: boolean;
  /** 合规校验已通过：历史画布只认 snapshot assets.material_status === Active */
  compliancePassed?: boolean;
  /** 合规校验未通过（当前会话内失败角标；二次进入不从节点 JSON 恢复） */
  complianceFailed?: boolean;
  /** 派生标记：资产在 snapshot 资产字典中查不到（素材已被删除），水合期计算 */
  assetMissing?: boolean;
  /** MIME 类型（上传完成后存储，如 "image/jpeg"） */
  mime?: string;
  /** 媒体宽度（图片/视频，像素） */
  width?: number;
  /** 媒体高度（图片/视频，像素） */
  height?: number;
  /** 时长秒（视频/音频） */
  duration?: number;
  /** 文件大小字节 */
  size?: number;
  /** 生成参数透传的目标比例（如 "16:9"），仅决定占位形状，不作原始分辨率展示 */
  targetRatio?: string;
  /** IKFM3S §4：「输入已更新」派生标记（渲染期注入，不持久化）：来源文本输入变化未被成功使用 */
  inputStale?: boolean;
  /** IKFM3S §4：第一条文本入边的来源文本卡 id（徽标定位入口） */
  inputSourceNodeId?: string | null;
  /** IKFM3S §6：定位来源文本卡（平移居中 + 选中高亮） */
  onLocateInputSource?: (sourceNodeId: string) => void;
  /** 「输入已更新」菜单：在当前节点用最新文本输入原位重新生成 */
  onUpdateGenerate?: (id: string) => void;
  /** IKFR4X 持续选取会话勾选标记（渲染期派生注入，不持久化）：已并入当前选取目标的来源 */
  pickMarked?: boolean;
  /** 会话期隐藏标记（IKGZ5O，渲染期派生注入，不持久化）：本卡为编辑会话（擦除/裁切/抠图/
   *  扩图等）源卡时由 CanvasPage 注入。工具条迁出（IKGYYD）后本字段不再控制渲染，退为
   *  可观测标记（集成测试断言会话进入/退出时序）；模态显隐由钉屏幕层 show 门
   *  （!editSessionActive）承担。高清/HD 参数面板打开不再注入此标记（IKHFUF）。 */
  soloToolbarHidden?: boolean;
  /** 视频选取会话中能力失效（如合规未通过）置灰 */
  pickBlocked?: boolean;
  /** 擦除编辑态遮罩层（IKGOTB，渲染期派生注入，不持久化）：本卡为擦除目标源图卡时由
   *  CanvasPage 注入——棋盘格渲染数据与指针回调；仅正常图片内容区渲染 */
  eraseEditing?: {
    ops: readonly MaskOp[];
    liveOp: MaskOp | null;
    onStrokeStart: (point: MaskPoint) => void;
    onStrokeMove: (point: MaskPoint) => void;
    onStrokeEnd: () => void;
  };
  /** 去字幕框选模式框层（IKGZ83，渲染期派生注入，不持久化）：本卡为去字幕会话源视频卡且
   *  会话处于框选模式时由 CanvasPage 注入——检测框渲染数据（半透明矩形描边）与拉框指针
   *  回调，仅正常视频内容区渲染；智能模式不注入（零框选工具）。停帧由 subtitleErasePaused
   *  单独承担（IKH3OU），与本标记解耦 */
  subtitleEraseEditing?: {
    boxes: readonly SubtitleBoxOp[];
    liveBox: SubtitleBoxOp | null;
    onBoxStart: (point: SubtitleBoxPoint) => void;
    onBoxMove: (point: SubtitleBoxPoint) => void;
    onBoxEnd: () => void;
  };
  /** 去字幕会话停帧标记（IKH3OU，渲染期派生注入，不持久化）：本卡为去字幕会话源视频卡时
   *  由 CanvasPage 注入，视频暂停锁定在当前帧（会话期无播放控制）。与 subtitleEraseEditing
   *  分开：框选模式两者都有，智能模式只有本标记——智能模式零框选工具，不渲染框层 */
  subtitleErasePaused?: true;
  /** 音视频分离编辑态标记（IKH28U，渲染期派生注入，不持久化）：本卡为音视频分离目标
   *  源视频卡时由 CanvasPage 注入——视频暂停在当前帧并锁定播放控制（透明锁定层接管
   *  指针，退出标记移除即恢复）；上方 X 工具条/下方发送条由 CanvasPage 浮出
   *  （VideoAudioSplitDialog） */
  splitEditing?: true;
  /** 音频截取编辑态标记（IKHB7A，渲染期派生注入，不持久化）：本卡为截取会话源音频卡
   *  时由 CanvasPage 注入——波形区叠加截取遮罩四件套（AudioTrimOverlay：选区框/抓手/
   *  暗区/秒数胶囊，接管指针不冒泡开音频面板），AudioPlayer 按选区钳制试听；发送条
   *  （AudioTrimBar）由 CanvasPage 浮出。选区（秒）与全长为遮罩几何与发送参数唯一
   *  数据源，抓手拖拽实时上抛 CanvasPage（发送条时间范围联动）。 */
  trimEditing?: {
    selection: { start: number; end: number };
    duration: number;
    onSelectionChange: (selection: { start: number; end: number }) => void;
  };
  /** 音频调速编辑态标记（IKHW5C 骨架 / IKHW5S 闭环，渲染期派生注入，不持久化）：本卡为
   *  调速会话源音频卡时由 CanvasPage 注入——true（IKHW5C 骨架形态）或携带倍速对象
   *  { speed }（IKHW5S）：进入即暂停+播放头归零（AudioPlayer 承担）、试听按倍速播放
   *  （playbackRate + preservesPitch）且卡内时间行按倍速折算，退出标记移除即恢复 1.0
   *  与源时长；源卡悬浮工具条隐藏由 CanvasPage 会话模态（editSessionActive）承担，
   *  波形区不加遮罩（调速无选区）；发送条（AudioSpeedBar）由 CanvasPage 浮出。 */
  speedEditing?: true | { speed: number };
  /** 音视频分离结果卡身份标记（IKH28X，建卡时随 data 持久化）：lastInput（源素材 + 所选
   *  格式）供失败重试原样重发创建接口；带此标记的失败占位卡才渲染重试钮（存量 ffmpeg 时代
   *  失败卡无身份不渲染，口径同家族身份分流先例） */
  mediaExtract?: MediaExtractIdentity;
  /** 音视频合成草稿卡身份标记（IKIHPK，建卡时随 data 持久化）：固定音频源 + 参数 +
   *  绑定视频，随卡持久化记住直到终态回填；草稿卡内容区据此区分未绑定/已就绪文案，
   *  拖线落点按此身份分流为绑定动作（见 audioVideoMux.ts） */
  audioVideoMux?: AudioVideoMuxIdentity;
  /** 裁切编辑态标记（IKGW1H，渲染期派生注入，不持久化）：本卡为裁切目标源图卡时由
   *  CanvasPage 注入——裁切框与面板（IKGW1N）、确认建卡（IKGW1S）据此接入 */
  cropEditing?: true;
  /** 浏览器量得真实媒体尺寸后回填（缺失或不一致时才回调） */
  onMediaDims?: (id: string, dims: MediaDims) => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onAddToChat?: (id: string) => void;
  onSaveToAssets?: (id: string) => void;
  /** 取消生成（生成中节点） */
  onCancelJob?: (id: string) => void;
  /** 重试（失败节点） */
  onRetryJob?: (id: string) => void;
  /** 卡片改名（IKFA8X）：提交归一化后的新名称；自定义状态由父级置 data.customName */
  onTitleChange?: (id: string, name: string) => void;
  /** 高清放大（IKGM9F）：在源卡右侧建「高清」草稿卡并连来源线（画质工具横排「高清」按钮派发，IKH3XZ） */
  onEnhanceImage?: (id: string) => void;
  /** 擦除（IKGOT7）：把本卡置为擦除编辑态（画质工具横排「擦除」按钮派发，IKH3XZ；门槛见 imageErase.ts） */
  onEraseImage?: (id: string) => void;
  /** 扩图（IKGOQX）：进入扩图模式（扩展框 + 参数面板，不建卡） */
  onOutpaintImage?: (id: string) => void;
  /** 裁切（IKGW1H）：把本卡置为裁切编辑态（画质工具横排「裁切」按钮派发，IKH3XZ；无门槛恒可用） */
  onCropImage?: (id: string) => void;
  /** 抠图（IKGXLT/IKGXMT）：进入抠图工具栏（画质工具横排「抠图」按钮派发，IKH3XZ；门槛见 imageCutout.ts） */
  onCutoutImage?: (id: string) => void;
  /** 智能去字幕（IKGZ82 入口 / IKH3OU 交互重做）：进入去字幕会话；mode 由「智能去字幕 ▾」
   *  下拉菜单项决定（smart=智能模式、box=框选模式），会话内不互切；
   *  门槛预检见 videoSubtitleErase.ts */
  onVideoSubtitleErase?: (id: string, mode: VideoSubtitleEraseMode) => void;
  /** 视频 HD 高清（IKH3VG）：在源卡右侧建 HD 草稿卡并弹出 HD 面板（视频卡工具条「HD」徽标
   *  按钮派发；置灰门槛见 videoEnhance.ts，发送任务接通归 IKH3VH） */
  onVideoEnhance?: (id: string) => void;
  /** 视频插帧（IKHLKR，父单 IKHLES）：在源卡右侧建插帧草稿卡并弹出插帧面板
   *  （「高清 ▾」下拉第二项派发；置灰门槛见 frameInterpolation.ts，发送闭环归 IKHLKX） */
  onFrameInterpolation?: (id: string) => void;
  /** 音视频分离（IKH28U 入口 / IKHA2E 改下拉触发钮）：进入音视频分离编辑态（「音视频分离 ▾」
   *  下拉首项与触发钮直启派发，原单按钮链路不变；置灰门槛见 audioVideoSplit.ts，发送闭环归 IKH28X） */
  onAudioVideoSplit?: (id: string) => void;
  /** 音频截取（IKHB6Y，父单 IKHB08）：音频卡工具条首位「截取」入口点亮派发（进入遮罩选段
   *  编辑态归 IKHB7A，本票只透出回调；置灰门槛见 audioTrim.ts——音频 URL 缺失或时长
   *  缺失/为 0 置灰，不照搬家族「数据缺失不拦」口径） */
  onTrimAudio?: (id: string) => void;
  onMixAudio?: (id: string) => void;
  /** 音视频合成（IKIHPK，父规格 IKIHMX / ADR-0115）：音频卡工具条第四钮「音视频合成」
   *  入口点亮派发（从源音频卡拉出合成草稿卡，草稿卡会话与拖线绑定归 IKIHPK，
   *  提交回填归 IKIHP M；置灰门槛见 audioVideoMux.ts——已完成音频成品卡 + 仅源
   *  音频 URL 缺失置灰） */
  onComposeAudioVideo?: (id: string) => void;
  /** 音频调速（IKHW5C，父单 IKHVYO）：音频卡工具条第二钮「调速」入口点亮派发（进入
   *  调速编辑态骨架归本票，编辑态本体——滑杆/发送条/提交——归 IKHW5S；置灰门槛见
   *  audioSpeed.ts——音频 URL 或资产 ID 缺失即置灰，时长缺失不拦） */
  onAudioSpeed?: (id: string) => void;
  /** 人声背景分离（IKHA2E 挂接点）：进入人声背景分离编辑态（「音视频分离 ▾」下拉第二项派发）；
   *  本票仅交付点击派发挂接点，编辑态本体由后续票实现——未注入时点击安全 no-op；
   *  置灰门槛同源整卡（audioVideoSplit.ts，未关联资产唯一置灰） */
  onVocalBackgroundSplit?: (id: string) => void;
  /** 场景切分（IKH8BJ）：进入场景切分编辑态（视频卡工具条「场景切分」按钮派发，
   *  置灰门槛见 sceneSplit.ts；编辑态本体由 IKH8BR 交付，本票只接通入口事件） */
  onSceneSplit?: (id: string) => void;
  /** 智能抠像（IKHK7N）：进入抠像编辑态（视频卡工具条「智能抠像 ▾」下拉菜单项与触发钮
   *  直启首项派发，mode 由菜单项决定：portrait=人像抠像、greenscreen=绿幕抠像）；
   *  置灰门槛见 smartMatting.ts；编辑态本体由 IKHK9N 交付，本票只接通入口事件 */
  onSmartMatting?: (id: string, mode: SmartMattingMode) => void;
  /** 下载媒体文件 */
  onDownload?: (id: string) => void;
  /** 查看媒体资产详情 */
  onShowDetails?: (id: string) => void;
  onPaste?: (id: string) => void;
  onCopyImage?: (id: string) => void;
  onComplianceCheck?: (id: string) => void;
  onFillEmptyShell?: (id: string, file: File) => void;
}

export default function MediaNode({ id, data, selected }: NodeProps & { data: MediaNodeData; selected?: boolean }) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const shellFileRef = useRef<HTMLInputElement>(null);
  /** 源视频元素引用：去字幕编辑态注入时暂停在当前帧（IKGZ83，本期无播放控制） */
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /** 未选中时用首帧画布占位，避免铺满的 <video> 合成层把工具栏点击偷走 */
  const videoPosterRef = useRef<HTMLCanvasElement | null>(null);
  /** 名称原位编辑（IKFA8X）：draft 为输入框内容；error 仅展示，不阻断画布保存 */
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameError, setNameError] = useState('');
  const [staleMenuOpen, setStaleMenuOpen] = useState(false);
  const staleMenuRef = useRef<HTMLDivElement>(null);

  const zoom = useStore((state) => state.transform[2]);
  /** 画布多选判定（IKJ7S1，复用 useSoloNodeSelected 的导出计数）：框选 / Ctrl 加选 /
   *  Ctrl+A 期间任何卡都不触发悬停自动播放（选中与否无关），并即时停掉进行中的会话 */
  const multiNodeSelection = useStore((state) => isMultiNodeSelection(state.nodes));
  const isSelect = data.toolMode === 'select';
  /** 去字幕会话锁定（IKH3NP 审查修订）：框选（subtitleEraseEditing 注入）与智能（仅
   *  subtitleErasePaused 注入）两模式都要停帧并关掉原生播放/进度条控件——智能模式不再
   *  注入框层，没有 inset:0 覆盖层替视频挡控件，controls 必须自己关；指针一并交还画布。 */
  const subtitleEraseLocked = data.subtitleEraseEditing != null || data.subtitleErasePaused === true;
  /** 树内 <video> + 自绘播放控件只给「当前选中」的视频卡（IKI5YM 起自绘控件替代原生
   *  controls）。选择工具下所有卡都渲染可播 video 时，Chromium 视频 GPU 层会把工具栏/
   *  小地图的点击偷走：节点被选中且直接开播。 */
  const videoInteractive = Boolean(selected) && isSelect && !subtitleEraseLocked;
  const [videoControlsArmed, setVideoControlsArmed] = useState(false);
  /** 悬停预览会话占屏中（IKJ7RS）：起播置 true，停止翻回；真值期树内布防延后——
   *  点选过渡（点击正在悬停播放的卡）靠它保住同一视频元素续播、声画不中断（IKJ7S1 落地：
   *  未布防选中卡过渡后仍走离屏会话路，已布防选中卡会话直接在树内控件视频上进行）。
   *  IKJ7OS 评审收口（故事 16/决策 8）：收养（adopted）会话定格/让位后保持 true——
   *  占屏语义持续阻断树内布防，不重建元素，末帧定格保持挂载。 */
  const [hoverPlaying, setHoverPlaying] = useState(false);
  /** 收养会话元素的稳定 ref（IKI5YM 审查修订）：悬停会话元素不在 React ref 里（命令式
   *  移入播放层），收养时经 state 持有——引用跨渲染稳定，VideoPlayerControls 的事件监听
   *  不因重渲染反复挂卸；完整收尾（非 keepFrame）即清空 */
  const [adoptedVideoRef, setAdoptedVideoRef] = useState<React.RefObject<HTMLVideoElement | null> | null>(null);
  /** 画面区按下坐标（IKI5YM）：树内 video 与收养会话元素共用——click 时判定位移，拖动松手不误触 */
  const videoPressRef = useRef<{ x: number; y: number } | null>(null);
  /** 悬停预览播放层宿主：空层零视觉零命中；开播时把离屏解码 video 命令式移入本层 */
  const hoverPreviewHostRef = useRef<HTMLDivElement | null>(null);
  /** 悬停会话（元素 + 监听 + 原址）：IKJ7RS 未选中卡元素即离屏解码 videoRef.current，
   *  会话持有到停止为止，homeHost 供停止时原址移回；IKJ7S1 选中卡（已布防）会话元素是
   *  树内控件 video——inTree 为 true：不迁移、收尾不清画面（末帧/暂停帧由原生元素状态保持），
   *  yielded 标记手动让位（原生控件暂停过：本次悬停不再自动续播、移开不尾播）。 */
  const hoverSessionRef = useRef<{
    video: HTMLVideoElement;
    onEnded: () => void;
    homeHost: Node | null;
    /** 选中卡树内控件会话：元素留在树内原位（无播放层迁移） */
    inTree: boolean;
    /** 手动让位：用户经控件或画面点击暂停过（play/seeked 重新接管即清除） */
    yielded: boolean;
    /** 点选过渡收养（IKJ7OS 故事 16）：控件布防到本会话元素——收尾保持画面
     *  （定格末帧/让位暂停帧留播放层），不归位不清层不重建（决策 8） */
    adopted?: boolean;
    /** 原生控件监听（仅 inTree 会话挂载）：pause=手动让位、play=重新接管、seeked=拖动续播 */
    onPause?: () => void;
    onPlay?: () => void;
    onSeeked?: () => void;
    /** 收养会话画面区点击切换播放监听（IKI5YM 审查修订，命令式挂原生事件） */
    onVideoMouseDown?: (event: MouseEvent) => void;
    onVideoClick?: (event: MouseEvent) => void;
  } | null>(null);
  /** 100ms 布防计时器：计时内移开即取消（划过不播，保持首帧海报） */
  const hoverTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!videoInteractive) {
      setVideoControlsArmed(false);
      // 会话播放中的元素就是 videoRef.current（IKJ7RS）：本 effect 随 hoverPlaying 翻转重跑时不得代停
      if (!hoverPlaying) videoRef.current?.pause();
      return;
    }
    // 点选过渡（IKJ7RS 建；IKJ7OS 改收养布防）：悬停播放中的卡被点选，树内布防被会话占屏
    // （hoverPlaying）阻断——自绘控件由收养逻辑叠加在同一会话元素上（IKI5YM 审查修订），
    // 不重建树内元素，声画不中断、定格保持挂载（决策 8）
    if (hoverPlaying) return;
    const timer = window.setTimeout(() => setVideoControlsArmed(true), 80);
    return () => window.clearTimeout(timer);
  }, [videoInteractive, hoverPlaying]);

  /** 提交名称：去空格/空回退/超长拒绝/未变更跳过，细则见 cardName */
  const commitName = useCallback(() => {
    const result = commitCardName(nameDraft, data.fileName ?? '');
    if (result.kind === 'invalid') {
      setNameError(result.message);
      return;
    }
    setNameError('');
    setNameEditing(false);
    if (result.kind === 'save') data.onTitleChange?.(id, result.value);
  }, [data, id, nameDraft]);

  /** Esc 取消：恢复编辑前名称；输入框随即卸载，不会再有失焦提交 */
  const cancelName = useCallback(() => {
    setNameDraft(data.fileName ?? '');
    setNameError('');
    setNameEditing(false);
  }, [data.fileName]);

  useDismissOnOutside([
    { open: staleMenuOpen, ref: staleMenuRef, dismiss: () => setStaleMenuOpen(false) },
  ]);

  useEffect(() => {
    if (!staleMenuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setStaleMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [staleMenuOpen]);

  // 点击其他区域关闭右键菜单（捕获阶段监听，确保右键其他节点时先关闭本菜单）
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    document.addEventListener('contextmenu', close, true);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close, true);
    };
  }, [contextMenu]);

  /** 去字幕会话（IKGZ83）：视频暂停锁定在当前帧——拉框对全片生效、画面定格便于精确框选；
   *  两模式共用会话锁定布尔（IKH3NP 审查修订：框层只在框选模式注入，智能模式借
   *  subtitleErasePaused 停在当前帧）。依赖稳定布尔而非每次渲染新生的对象引用，
   *  语义不变且不再靠引用变化反复重放。 */
  useEffect(() => {
    if (!subtitleEraseLocked) return;
    videoRef.current?.pause();
  }, [subtitleEraseLocked]);

  /** 音视频分离编辑态（IKH28U）：进入即定格在当前帧，锁定层接管指针，标记移除即恢复 */
  useEffect(() => {
    if (!data.splitEditing) return;
    videoRef.current?.pause();
  }, [data.splitEditing]);

  /** 截取遮罩定位条 → AudioPlayer 命令式桥（IKHB7A）：按下暂停记 wasPlaying、松手按
   *  wasPlaying 与「未拖到选区尾」续播（拖到尾停终点）；hook 细节见 AudioPlayer.tsx。 */
  const trimSeekBridge = useAudioTrimSeekBridge();

  const isEmptyShell = data.emptyShell === true;
  const isGenHost =
    data.draft === true
    || data.genStatus === 'draft'
    || data.genStatus === 'generating'
    || data.genStatus === 'failed'
    || data.genStatus === 'cancelled'
    || data.jobId != null
    || data.imageCrop != null;
  /** 上传素材只作出源，左侧不加号；生成节点（含图片草稿）一律接收入边。
   *  不按 isFirst 隐藏——首卡与其余卡同口径，否则草稿当画布第一张时无法被图片素材连入。 */
  const showTargetHandle = !isEmptyShell && isGenHost;
  const blockNodeMenu =
    isEmptyShell || data.genStatus === 'generating' || data.genStatus === 'checking';

  /** 右键菜单：空壳 / 生成中不弹；草稿可弹（仅创建副本 / 删除） */
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (data.toolMode !== 'select') return;
    e.preventDefault();
    e.stopPropagation();
    if (blockNodeMenu) return;
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, [data.toolMode, blockNodeMenu]);

  const handleDelete = useCallback(() => {
    setContextMenu(null);
    data.onDelete?.(id);
  }, [data, id]);

  /** 在旁边复制一个相同节点 */
  const handleDuplicate = useCallback(() => {
    setContextMenu(null);
    data.onDuplicate?.(id);
  }, [data, id]);

  /** 添加到 Agent 聊天 */
  const handleAddToChat = useCallback(() => {
    setContextMenu(null);
    data.onAddToChat?.(id);
  }, [data, id]);

  const acceptShellFile = useCallback((file: File | undefined) => {
    if (!file) return;
    data.onFillEmptyShell?.(id, file);
  }, [data, id]);

  /** 保存到共享资产（共享资产下线，入口已隐藏） */
  // const handleSaveToAssets = useCallback(() => {
  //   setContextMenu(null);
  //   console.log('[MediaNode] 保存到共享资产', { nodeId: id, hasCallback: !!data.onSaveToAssets, assetId: data.assetId, mediaType: data.mediaType });
  //   data.onSaveToAssets?.(id);
  // }, [data, id]);

  /** 浏览器实测尺寸回填：仅在缺失或与既有数据不一致时上报，避免回填抖动 */
  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    if (!w || !h) return;
    if (data.width === w && data.height === h) return;
    data.onMediaDims?.(id, { width: w, height: h });
  }, [data, id]);

  const syncVideoDims = useCallback((video: HTMLVideoElement) => {
    const { videoWidth: w, videoHeight: h, duration } = video;
    const dims: MediaDims = {};
    if (w > 0) dims.width = w;
    if (h > 0) dims.height = h;
    if (Number.isFinite(duration) && duration > 0 && typeof data.duration !== 'number') {
      dims.duration = duration;
    }
    const widthUnchanged = dims.width === undefined || data.width === dims.width;
    const heightUnchanged = dims.height === undefined || data.height === dims.height;
    if (widthUnchanged && heightUnchanged && dims.duration === undefined) return;
    data.onMediaDims?.(id, dims);
  }, [data, id]);

  /** 视频播放失败兜底（双源全部失败/解码失败）：错误态替换黑屏为明确提示 +
   *  新窗口打开入口；src 任一变化即复位重试 */
  const [videoError, setVideoError] = useState<{ code?: number } | null>(null);
  useEffect(() => {
    setVideoError(null);
  }, [data.src, data.srcH264]);

  /** 悬停预览排除态与起播门（IKJ7RS 建链；IKJ7S1 翻转起播门）：blocked=会话排除态
   *  （会话中出现即停，含多选抑制），eligible=起播门（选中卡与未选中卡同门——选中已布防卡
   *  在树内控件视频上就地开播）。入参不含「选中」：选中本身不是排除态，点选过渡续播不被停，
   *  过渡后自绘控件叠加由组件内收养逻辑承担（IKJ7OS 故事 16 建；IKI5YM 审查修订去原生控件）。 */
  const hoverPreviewInput = {
    mediaType: data.mediaType,
    src: data.src,
    toolMode: data.toolMode,
    hasVideoError: videoError != null,
    genStatus: data.genStatus,
    draft: data.draft,
    assetMissing: data.assetMissing,
    emptyShell: data.emptyShell,
    subtitleEraseLocked,
    splitEditing: data.splitEditing === true,
    multiSelected: multiNodeSelection,
  };
  const hoverPreviewBlocked = videoHoverPreviewBlocked(hoverPreviewInput);
  const hoverPreviewEligible = videoHoverPreviewEligible(hoverPreviewInput);

  /** 结束悬停预览会话（IKJ7RS 建；IKJ7S1 扩树内路；IKJ7OS 评审收口加收养会话收尾模式）：
   *  默认收尾：停播、卸监听；未选中卡路归零回首帧、元素移出播放层并复位悬停期状态
   *  （muted 回 true，离屏解码器默认静音——归位即回默认），首帧海报画布随显；选中卡树内路
   *  不动画面——末帧/手动暂停帧由原生元素状态保持（尾播定格与让位帧都不清）。
   *  keepFrame（IKJ7OS 收养会话收尾，故事 12/决策 8）：画面与会话都保持——定格末帧/
   *  让位暂停帧留播放层、监听保留供重入就地重播（videoRef 可能已随重渲染换新，收养元素
   *  是画面与解码缓存的唯一持有者），hoverPlaying 不翻回（占屏持续阻断树内布防重建）。
   *  幂等：无会话/空层时安全 no-op。 */
  const endHoverPlayback = useCallback((options: { keepFrame?: boolean } = {}) => {
    const { keepFrame = false } = options;
    if (hoverTimerRef.current != null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (keepFrame) return;
    const session = hoverSessionRef.current;
    hoverSessionRef.current = null;
    if (session) {
      session.video.removeEventListener('ended', session.onEnded);
      if (session.onPause) session.video.removeEventListener('pause', session.onPause);
      if (session.onPlay) session.video.removeEventListener('play', session.onPlay);
      if (session.onSeeked) session.video.removeEventListener('seeked', session.onSeeked);
      if (session.onVideoMouseDown) session.video.removeEventListener('mousedown', session.onVideoMouseDown);
      if (session.onVideoClick) session.video.removeEventListener('click', session.onVideoClick);
      // 收养态命中恢复随完整收尾撤销（归位即回未选中纯展示的层穿透口径）
      session.video.classList.remove(styles.adopted);
      session.video.pause();
      if (!session.inTree) {
        try {
          session.video.currentTime = 0;
        } catch {
          // 元数据未就绪时个别实现拒绝赋值：无碍，下次起播仍会归零
        }
        // 原址移回离屏宿主（解码缓存与挂载状态保持 hover 前原样）；点选过渡布防翻转
        // 会拆宿主，届时 isConnected 为 false 跳过——元素随播放层卸载即停
        if (session.homeHost?.isConnected) session.homeHost.appendChild(session.video);
        // 展示期结束即复位悬停期状态（IKJ7OS 决策 9）：有声开播改写的 muted 回离屏默认静音
        session.video.muted = true;
      }
    }
    const host = hoverPreviewHostRef.current;
    while (host && host.firstChild) host.removeChild(host.firstChild);
    setAdoptedVideoRef(null);
    setHoverPlaying(false);
  }, []);

  /** 原生控件让位/接管监听（IKJ7S1 树内会话建；IKJ7OS 收养会话补挂同款）：
   *  pause=手动让位（本次悬停不再自动续播、移开不尾播）、play=重新接管、
   *  seeked=拖动即接管从拖动点续播。返回 handlers 供会话记录、收尾时卸载。 */
  const attachControlListeners = useCallback((video: HTMLVideoElement) => {
    const onPause = () => {
      // 手动让位：用户点原生控件暂停（播完到头的自然 pause 在 ended 置位后不算）
      if (video.ended) return;
      const session = hoverSessionRef.current;
      if (session?.video === video) session.yielded = true;
    };
    const onPlay = () => {
      // 重新接管：手动恢复播放或播完重播，让位解除（原生控件行为优先）
      const session = hoverSessionRef.current;
      if (session?.video === video) session.yielded = false;
    };
    const onSeeked = () => {
      // 拖动进度即接管前进：从拖动点续播（暂停中拖动也续播），让位解除
      const session = hoverSessionRef.current;
      if (session?.video !== video) return;
      session.yielded = false;
      if (video.paused) video.play().catch(() => {});
    };
    video.addEventListener('pause', onPause);
    video.addEventListener('play', onPlay);
    video.addEventListener('seeked', onSeeked);
    return { onPause, onPlay, onSeeked };
  }, []);

  /** 收养离屏悬停会话为选中卡控件会话（IKJ7OS 故事 16 建；IKI5YM 审查修订去原生控件）：
   *  不再对会话元素开原生 controls（原生控件正是画面区拖不动整卡的根因），改为把树内
   *  同款自绘控件（VideoPlayerControls）经稳定 ref 叠加到会话元素上，补挂让位/接管监听
   *  （树内会话同款，手动暂停/拖进度的让位规则同样生效）与画面区点击切换播放（6px
   *  位移阈值，拖动整卡松手不误触）。收养期恢复指针命中（styles.adopted）：层穿透合同
   *  （!832）只约束未选中悬停纯展示期。收养会话收尾保持画面（定格末帧/让位暂停帧留
   *  播放层），重入经离屏路重播收养，全程不重建元素。两个入口：点选过渡（选中翻转
   *  effect）与选中态离屏开播（startHoverPlayback，重播轮）。 */
  const adoptHoverSession = useCallback((session: { video: HTMLVideoElement; adopted?: boolean; onPause?: () => void; onPlay?: () => void; onSeeked?: () => void }) => {
    session.adopted = true;
    Object.assign(session, attachControlListeners(session.video));
    const onVideoMouseDown = (event: MouseEvent) => {
      videoPressRef.current = { x: event.clientX, y: event.clientY };
    };
    const onVideoClick = (event: MouseEvent) => {
      const press = videoPressRef.current;
      videoPressRef.current = null;
      if (!press || isVideoClickSlop(press, event.clientX, event.clientY)) return;
      toggleVideoPlayback(session.video);
    };
    session.video.addEventListener('mousedown', onVideoMouseDown);
    session.video.addEventListener('click', onVideoClick);
    Object.assign(session, { onVideoMouseDown, onVideoClick });
    // 层穿透失效换收养态命中：画面可拖整卡、可点切换播放
    session.video.classList.add(styles.adopted);
    // 自绘控件叠加（state 持稳定 ref，引用不变则控件的事件监听不反复挂卸）
    setAdoptedVideoRef((prev) => (prev?.current === session.video ? prev : { current: session.video }));
  }, [attachControlListeners]);

  /** 开播（IKJ7RS 建；IKJ7S1 分双路）。未选中卡：把离屏解码元素移入内容区播放层，同一元素
   *  从头、有声开播。选中已布防卡：树内控件视频就地从头开播（IKI5YM 合并后无原生控件，
   *  自绘控件承担暂停/进度，muted/volume 维持元素状态——元素存活期内有效，不做任何记忆）。
   *  两路 play() 被浏览器自动播放策略拒绝时静默降级静音重试（catch 分支，无任何提示，不做预先探测）。 */
  const startHoverPlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video || hoverSessionRef.current) return;
    const host = hoverPreviewHostRef.current;
    if (host == null) {
      // 选中卡树内控件路（IKJ7S1）：布防后播放层未渲染（host 为 null）即是本路。
      // 已在播放（用户经自绘控件或画面点击手动开播）时不接管不归零，用户行为照旧。
      if (!video.paused) return;
      const onEnded = () => {
        // 本轮播完定格末帧（树内元素原位停住）；hoverPlaying 翻回不影响已完成的布防
        setHoverPlaying(false);
      };
      const { onPause, onPlay, onSeeked } = attachControlListeners(video);
      hoverSessionRef.current = { video, onEnded, homeHost: null, inTree: true, yielded: false, onPause, onPlay, onSeeked };
      video.addEventListener('ended', onEnded);
      video.loop = false;
      try {
        video.currentTime = 0;
      } catch {
        // 未加载出元数据时本就从 0 起播，忽略
      }
      setHoverPlaying(true);
      video.play().catch(() => {
        // 有声开播被拒（hover 非用户激活手势）：静默降级静音开播，无任何提示；
        // 用户已静音的元素按静音起播（尊重控件状态），catch 只兜自动播放策略拒绝
        if (hoverSessionRef.current?.video !== video) return;
        video.muted = true;
        video.play().catch(() => {});
      });
      return;
    }
    const onEnded = () => {
      // 播完一轮定格末帧不循环（元素留在播放层）。收养会话（点选过渡后）保持占屏：
      // hoverPlaying 不翻回、元素保持挂载（决策 8：定格=暂停在结尾，不重建回首帧）；
      // 未选中卡翻回放行后续流程（移开收尾/重播收尾）
      if (!hoverSessionRef.current?.adopted) setHoverPlaying(false);
    };
    hoverSessionRef.current = { video, onEnded, homeHost: video.parentNode, inTree: false, yielded: false };
    video.addEventListener('ended', onEnded);
    while (host.firstChild) host.removeChild(host.firstChild);
    host.appendChild(video);
    try {
      video.currentTime = 0;
    } catch {
      // 未加载出元数据时本就从 0 起播，忽略
    }
    video.muted = false;
    setHoverPlaying(true);
    video.play().catch(() => {
      // 有声开播被拒（hover 非用户激活手势）：静默降级静音开播，无任何提示
      if (hoverSessionRef.current?.video !== video) return;
      video.muted = true;
      video.play().catch(() => {
        // 静音仍被拒的极端环境：维持首帧海报静默
      });
    });
  }, [attachControlListeners]);

  /** 进入内容区（IKJ7RS 建；IKJ7S1 扩选中卡；IKJ7OS 评审收口限定鼠标）：满 100ms 才开播，
   *  计时内划过不播；触屏 pointerenter（长按/点按）不起播——触屏维持点选+控件现状（故事 29）。
   *  收养会话重入（IKJ7OS）：定格末帧/让位暂停帧就地从头重播——不收尾不清层不换元素
   *  （videoRef 可能已随重渲染换新，收养元素是画面与解码缓存的唯一持有者，决策 8）；
   *  非收养会话残留先默认收尾再布防新一轮。本轮仍在播（含尾播中重入）不打断不重播。 */
  const handleContentPointerEnter = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    if (!hoverPreviewEligible) return;
    const session = hoverSessionRef.current;
    if (session && !session.video.paused && !session.video.ended) return;
    if (session && session.adopted) {
      if (hoverTimerRef.current != null) return;
      hoverTimerRef.current = window.setTimeout(() => {
        hoverTimerRef.current = null;
        const adopted = hoverSessionRef.current;
        if (!adopted || adopted !== session) return;
        try {
          adopted.video.currentTime = 0;
        } catch {
          // 元数据未就绪时个别实现拒绝赋值：无碍，play 从当前位置起
        }
        if (adopted.video.paused) {
          adopted.video.play().catch(() => {
            // 重播被拒（罕见：本轮已有声播放过，手势已解锁）：静默维持定格/暂停帧
          });
        }
      }, HOVER_PREVIEW_DELAY_MS);
      return;
    }
    if (session) endHoverPlayback();
    if (hoverSessionRef.current || hoverTimerRef.current != null) return;
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      startHoverPlayback();
    }, HOVER_PREVIEW_DELAY_MS);
  }, [hoverPreviewEligible, startHoverPlayback, endHoverPlayback]);

  /** 移出内容区（IKJ7RS 建；IKJ7S1 扩尾播特权；IKJ7OS 评审收口扩收养会话）：计时内移开不播。
   *  未选中卡播放中移开立即停并回首帧海报；选中卡本轮播放中移开不停止（尾播），继续播到
   *  ended 定格末帧；让位后（原生控件暂停）或已播完则收尾——让位保持暂停帧，播完定格即清
   *  会话；收养会话（点选过渡后）keepFrame：暂停帧/定格末帧保持挂载不回首帧（决策 8）。 */
  const handleContentPointerLeave = useCallback(() => {
    if (hoverTimerRef.current != null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (selected) {
      const session = hoverSessionRef.current;
      if (!session) return;
      if (session.yielded || session.video.ended) {
        endHoverPlayback(session.adopted ? { keepFrame: true } : {});
      }
      return;
    }
    endHoverPlayback();
  }, [selected, endHoverPlayback]);

  /** 排除态出现（会话锁定/生成流程/素材缺失/空壳/加载失败/抓手/多选）立即结束会话
   *  （IKJ7RS 建；IKJ7S1 加入多选抑制）：选中卡树内会话同口径就地停播——本 effect 只停播
   *  不重置帧，画面随后由排除态自身的卸载/锁层接管（非保持当前帧） */
  useEffect(() => {
    if (hoverPreviewBlocked) endHoverPlayback();
  }, [hoverPreviewBlocked, endHoverPlayback]);

  /** 选中翻转：取消在途布防计时（点选先于 100ms 布防完成则不起播，点选过渡只衔接
   *  已在悬停播放的会话），过渡会话交由后续流程接管（IKJ7RS） */
  useEffect(() => {
    if (!selected || hoverTimerRef.current == null) return;
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  }, [selected]);

  /** 点选过渡收养（IKJ7OS 故事 16；IKI5YM 审查修订去原生控件）：点击正在悬停播放的
   *  未布防卡，收养悬停会话——自绘控件叠加在同一元素上、让位/点击监听补挂。即刻收养
   *  而非计时后：点选后即刻播完的竞态同样保持定格挂载（决策 8：定格=暂停在结尾、
   *  保持挂载，不重建树内元素回首帧）。 */
  useEffect(() => {
    if (!selected || !hoverPlaying) return;
    const session = hoverSessionRef.current;
    if (!session || session.inTree) return;
    adoptHoverSession(session);
  }, [selected, hoverPlaying, adoptHoverSession]);

  /** 点选过渡后取消选中：回到未选中规则立即停播回首帧海报（IKJ7RS）。
   *  只在「选中→未选中」翻转时清理（prevSelected 门）：hoverPlaying 在依赖里是为了
   *  收养会话收尾后（定格/暂停帧占屏、session 已清）取消选中仍能清层复原海报，
   *  不能让未选中卡的悬停开播（hoverPlaying 翻 true）误触发清理（IKJ7OS）。 */
  const prevSelectedRef = useRef(selected);
  useEffect(() => {
    const wasSelected = prevSelectedRef.current;
    prevSelectedRef.current = selected;
    if (!(wasSelected && !selected)) return;
    if (hoverSessionRef.current != null || hoverPlaying) endHoverPlayback();
  }, [selected, hoverPlaying, endHoverPlayback]);

  /** 卸载清理（IKJ7RS）：停播 + 移出播放层，防元素与监听泄漏 */
  useEffect(endHoverPlayback, [endHoverPlayback]);

  /** 元数据/首帧/缓存命中共用：立刻回填已能量到的时长，seek 完成后再补宽高。
   *  静默解码失败形态（Windows/Edge 无 HEVC 解码实测）：数据齐（readyState≥2）
   *  但视频轨量不出尺寸且不派发 error 事件——videoWidth=0 视为编码不支持，走兜底。 */
  const drawVideoPoster = useCallback((video: HTMLVideoElement) => {
    const canvas = videoPosterRef.current;
    if (!canvas) return;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);
  }, []);

  const hydratePausedVideo = useCallback((video: HTMLVideoElement | null) => {
    if (!video) return;
    if (video.readyState >= 2 && video.videoWidth === 0 && video.videoHeight === 0) {
      setVideoError({ code: 4 });
      return;
    }
    syncVideoDims(video);
    paintVideoFirstFrame(video, (ready) => {
      syncVideoDims(ready);
      drawVideoPoster(ready);
    });
  }, [drawVideoPoster, syncVideoDims]);

  const handleVideoReady = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    hydratePausedVideo(e.currentTarget);
  }, [hydratePausedVideo]);

  /** 未选中时不把 <video> 放进卡片：Chromium 合成层会穿透工具栏。解码挂到 body，只往画布画首帧。 */
  useEffect(() => {
    if (videoControlsArmed) {
      hydratePausedVideo(videoRef.current);
      return;
    }
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;left:-240px;top:-240px;width:8px;height:8px;overflow:hidden;pointer-events:none;opacity:0';
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    /* 画面区裸给 React Flow（IKI5YM 审查修订）：nodrag/nopan 随收养期原生控件一并移除
       ——该 class 当时的存在理由是收养布防的原生控件防误拖，理由消失即移除，画面区回归
       节点拖拽路径；controlsList/禁画中画等只为原生控件服务的配置同批清理，播放控制由
       收养自绘控件（adoptHoverSession 叠加）与画面区点击切换承担 */
    videoRef.current = video;
    for (const source of videoSourceList(data.src, data.srcH264)) {
      const el = document.createElement('source');
      el.src = source.src;
      el.type = source.type;
      video.appendChild(el);
    }
    const onReady = () => hydratePausedVideo(video);
    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('loadeddata', onReady);
    // 离屏解码也要接住 error：404/编码不支持在未选中卡上同样需要兜底占位（!832 合同），
    // 口径与选中态 onError 一致——code 1（换源主动中止）不算失败
    const onError = () => {
      const code = video.error?.code;
      if (code === 1) return;
      setVideoError({ code });
    };
    video.addEventListener('error', onError);
    host.appendChild(video);
    document.body.appendChild(host);
    video.load();
    return () => {
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onError);
      host.remove();
      if (videoRef.current === video) videoRef.current = null;
    };
  }, [data.src, data.srcH264, hydratePausedVideo, videoControlsArmed]);

  const handleVideoError = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const code = e.currentTarget.error?.code;
    // code 1（MEDIA_ERR_ABORTED）多为换源主动中止，不算失败
    if (code === 1) return;
    setVideoError({ code });
  }, []);

  /** 画面区点击播放/暂停（IKI5YM）：自绘控件无原生画面点击行为，按下坐标供 click 判定
   *  位移——拖动整卡松开时浏览器仍派发 click，位移超阈值不算点击，防误触播放。
   *  收养会话元素走命令式监听（adoptHoverSession），与此处共用按下坐标与判定 */
  const handleVideoPressDown = useCallback((event: React.MouseEvent<HTMLVideoElement>) => {
    videoPressRef.current = { x: event.clientX, y: event.clientY };
  }, []);
  const handleVideoClick = useCallback((event: React.MouseEvent<HTMLVideoElement>) => {
    const press = videoPressRef.current;
    videoPressRef.current = null;
    if (!press || isVideoClickSlop(press, event.clientX, event.clientY)) return;
    toggleVideoPlayback(videoRef.current);
  }, []);

  const isAudio = data.mediaType === 'audio';
  const Icon = data.mediaType === 'video' ? Video : isAudio ? AudioLines : Image;
  const isDraft = data.genStatus === 'draft';
  /** 右侧出源手柄可见性：空壳与待生成草稿不出（草稿转生成中/成品时才补挂进 DOM） */
  const showSourceHandle = !isEmptyShell && !isDraft;
  /** React Flow 只在节点首测与尺寸变化时测量 handleBounds：手柄显隐翻转而节点同尺寸
   *  （草稿占位与成品同形，IKHHCN）时库不重测，新挂载手柄永远不注册、拖线静默无响应，
   *  须在显隐翻转时手动触发重测（库对动态手柄的指定姿势）。挂载首测库自己量，只在
   *  翻转时补测——冗余首调在 jsdom 会撞 DOMMatrixReadOnly 缺桩（IKHHCN 门禁实证）。 */
  const updateNodeInternals = useUpdateNodeInternals();
  const handleVisibilityRef = useRef<[boolean, boolean] | null>(null);
  useEffect(() => {
    const prev = handleVisibilityRef.current;
    handleVisibilityRef.current = [showTargetHandle, showSourceHandle];
    if (prev === null) return;
    if (prev[0] === showTargetHandle && prev[1] === showSourceHandle) return;
    updateNodeInternals(id);
  }, [updateNodeInternals, id, showTargetHandle, showSourceHandle]);
  const isGenerating = data.genStatus === 'generating';
  const isChecking = data.genStatus === 'checking';
  const isGenDone = data.genStatus === 'failed' || data.genStatus === 'cancelled';
  /** IKDMQU Q5：有旧素材（有效 http 素材 src）的生成中卡片继续显示素材，仅叠加状态角标；
   *  blob 预览（上传中/占位 fixture）不算旧素材，走占位 genBox */
  const hasMediaSrc =
    typeof data.src === 'string' && data.src !== '' && !data.src.startsWith('blob:');
  const isMediaExtraction = isMediaExtractNodeId(id);
  /** 截取占位卡（IKHB7A）：audio-trim-{jobId} 前缀；重试钮按 audioTrim 身份分流（同族先例） */
  const isAudioTrimCard = isAudioTrimNodeId(id);
  const isAudioMixCard = isAudioMixNodeId(id);
  /** 插帧草稿卡（IKHLKX）：插帧卡与 HD 卡共用 media-draft- 前缀，无法按 id 分流，故按身份判定
   *  ——失败重试须带冻结源素材（frameInterpolation.sourceAssetId），重试据此原样重发创建接口；
   *  身份残缺的失败卡不渲染重试钮（同 media_extract / audio_trim 身份守卫口径）。 */
  const frameInterpolationIdentity = data.frameInterpolation as { sourceAssetId?: string } | undefined;
  const frameInterpolationRetryable =
    frameInterpolationIdentity == null
    || (typeof frameInterpolationIdentity.sourceAssetId === 'string' && frameInterpolationIdentity.sourceAssetId !== '');
  const hideCancel = isMediaExtraction
    || isAudioTrimCard
    || isAudioMixCard
    || isCanvasToolGeneration(data as Record<string, unknown>);
  const generationOverlay = mediaNodeGenerationOverlay(isMediaExtraction, hideCancel);
  const failHeadline = mediaNodeFailHeadline({
    genStatus: data.genStatus,
    errorText: data.errorText,
    isMediaExtraction,
  });

  const contentBox = mediaContentBox({
    mediaType: data.mediaType,
    width: data.width,
    height: data.height,
    ratio: data.targetRatio,
  });

  /** 标题右侧元信息：仅真实媒体数据，缺失项留空；目标比例/占位尺寸不展示，文件大小只在详情。
   *  音频无可视分辨率，只显真实时长；图片/视频显分辨率，视频另加时长。 */
  const titleMeta = isAudio
    ? durationLabel(data.duration)
    : [
        data.width && data.height ? `${data.width}×${data.height}` : '',
        data.mediaType === 'video' ? durationLabel(data.duration) : '',
      ]
        .filter(Boolean)
        .join(' ');

  /** 生成中 / 失败 / 素材缺失占位（音频与图片/视频共用内部内容） */
  const renderPlaceholder = () => {
    if (isDraft) {
      const isImageDraft = data.mediaType === 'image';
      const isVideoDraft = data.mediaType === 'video';
      // 高清草稿（IKGM9F）专属占位文案；参数面板由 IKGM9O 接入
      // 视频 HD 高清草稿（IKH3VG）同款专属占位；面板由本票接入
      // 视频插帧草稿（IKHLKR）同款专属占位（父单指定文案）；面板由本票接入
      // 音视频合成草稿卡（IKIHPK）：未绑定引导 / 已绑定就绪（面板由 AudioVideoMuxPanel 承担）
      const draftHint = isImageDraft && data.imageEnhance
        ? '配置参数生成高清图像'
        : isVideoDraft && data.videoEnhance
          ? '配置参数生成高清视频'
          : isVideoDraft && data.frameInterpolation
            ? '配置参数生成插帧视频'
            : isVideoDraft && data.audioVideoMux
              ? (data.audioVideoMux.video ? '已就绪，点击发送生成' : '选择视频并配置参数')
              : isVideoDraft ? '视频生成' : isImageDraft ? '图片生成' : '待生成';
      return (
        <div className={styles.genBox}>
          {isVideoDraft ? <Video size={22} strokeWidth={1.8} color="#666" /> : <Image size={22} strokeWidth={1.8} color="#666" />}
          <span className={styles.missingText}>{draftHint}</span>
        </div>
      );
    }
    if (isGenerating) {
      /* 生成中：转圈；音频提取展示真实进度；生图/生视频可取消，画布工具卡不开放取消 */
      return (
        <div className={styles.genBox}>
          <div className={styles.genSpinner} />
          {isAudioMixCard && data.audioMixCancelPending === true &&
            <span className={styles.genText}>正在取消</span>}
          {generationOverlay.showProgress && (
            <>
              <span className={styles.genText}>
                {generationOverlay.progressLabel}
                {typeof data.progress === 'number' ? ` ${data.progress}%` : '…'}
              </span>
              <div
                className={styles.progressTrack}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={typeof data.progress === 'number' ? data.progress : 0}
              >
                <div className={styles.progressFill} style={{ width: `${data.progress ?? 0}%` }} />
              </div>
            </>
          )}
          {generationOverlay.showCancel && (
            <button className={styles.genBtn} onClick={() => data.onCancelJob?.(id)}>
              取消生成
            </button>
          )}
        </div>
      );
    }
    if (isChecking) {
      /* IKIZQD/IKIZQE：提交结果不明核对锁定——任务已发往上游但结果未知，不重发、不退款，
         轮询等核对定夺（明确成功恢复原任务/明确失败释放预扣）；期间禁止再次提交 */
      return (
        <div className={styles.genBox} data-testid="job-checking-box">
          <div className={`${styles.genSpinner} ${styles.checkingSpinner}`} />
          <span className={styles.checkingText}>状态核对中</span>
          <span className={styles.genSub}>提交结果核对中，请勿重复提交</span>
        </div>
      );
    }
    if (isGenDone) {
      /* 失败/已取消：错误提示 + 退费说明 + 重试（重试钮按身份分流：媒体提取卡带 mediaExtract 身份
          才可重试——IKH28X 编辑态发送的失败卡原参数重发；截取卡带 audioTrim 身份才可
          重试——IKHB7A lastInput 原参数重发；插帧卡带冻结源素材才可重试——IKHLKX 原 fps
          重发创建接口；存量无身份失败卡不渲染。IKIZQE：成片失败卡不提供同 Draft ID 重试
          ——首版关闭（契约 FINALIZE_SOURCE_UNIQUE_KEY 语义）；IKJ7UI：其续作入口改形为
          与普通失败卡同款的「重试」按钮（见下方失败区分支，行为仍为新建样片卡）。） */
      const canRetry = data.genStatus === 'failed'
        && data.videoStage !== 'final'
        && (!isMediaExtraction || data.mediaExtract != null)
        && (!isAudioTrimCard || data.audioTrim != null)
        && (!isAudioMixCard || data.jobId != null)
        && frameInterpolationRetryable;
      return (
        <div className={styles.genBox}>
          <span className={styles.genFailText}>{failHeadline}</span>
          {data.chargeState === 'released' && (
            <span className={styles.genSub} data-testid="charge-refund-note">本次未消耗积分，预扣已退回</span>
          )}
          {canRetry && (
            <button className={styles.genBtn} onClick={() => data.onRetryJob?.(id)}>
              重试
            </button>
          )}
          {/* IKJ7UI（ADR-0119）：成片失败卡的续作路径——与普通失败卡完全同形的「重试」
              （不带积分文字，报价经悬停提示传达），但行为不是重发成片——同一张样片不可
              再次发起成片（契约 FINALIZE_SOURCE_UNIQUE_KEY 语义，金标 G08），而是按原输入
              新建样片卡（父规格用户故事 21，IKIZQG 链路）；点击在入口卡邻近新建样片卡，
              本失败卡与费用状态保留，样片完成后再单独发起成片（另行计费）。 */}
          {data.videoStage === 'final' && data.regenerateCta && (() => {
            const cta = data.regenerateCta;
            const disabled = cta.phase !== 'ready';
            return (
              <button
                type="button"
                className={styles.genBtn}
                data-testid="regenerate-cta"
                disabled={disabled}
                title={cta.phase === 'ready'
                  ? `按原输入新建 480P 样片，预计消耗 ${cta.credits} 积分；样片完成后再单独发起成片（另行计费）`
                  : cta.phase === 'loading'
                    ? '正在获取样片报价'
                    : cta.phase === 'checking'
                      ? '上次提交结果不明，正在核对，请勿重复提交'
                      : '暂不能重新生成样片（无报价）'}
                onClick={(event) => {
                  event.stopPropagation();
                  if (disabled) return;
                  data.onRegenerateSample?.(id);
                }}
              >
                重试
              </button>
            );
          })()}
        </div>
      );
    }
    /* 素材已被删除：灰色占位（资产在 snapshot 字典中查不到） */
    return (
      <div className={styles.missingBox}>
        <ImageOff size={22} strokeWidth={1.8} color="#666" />
        <span className={styles.missingText}>素材已被删除</span>
      </div>
    );
  };

  return (
    <div
      className={`${styles.wrapper} ${selected ? styles.selected : ''} ${data.pickBlocked ? styles.pickBlocked : ''}`}
      data-media-type={data.mediaType ?? 'image'}
      onContextMenu={handleContextMenu}
      style={{ ...nodeTitleSizing(zoom), width: contentBox.width }}
    >
      {/* 外部常驻标题 + 独立圆角内容主体（三类媒体共用；音频内容区恒横矩形）。
          选中态悬浮工具条已迁出（IKGYYD）：钉屏幕层由 CanvasPage 经 NodeFollowToolbar 渲染
          MediaNodeToolbar（拖动/缩放实时跟随、屏幕尺寸恒定），不再位于节点卡 DOM 内。 */}
      <div className={styles.titleRow} data-testid="media-title">
        <div className={styles.titleLeft}>
          <Icon className={styles.titleIcon} strokeWidth={2} color="#888" />
          {nameEditing ? (
            <input
              className="nodrag nopan"
              aria-label="卡片名称"
              value={nameDraft}
              autoFocus
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={commitName}
              onKeyDown={(event) => {
                // 名称输入期间隔离画布快捷键；输入法组合中的回车只确认候选词，不提交名称
                event.stopPropagation();
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  commitName();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelName();
                }
              }}
            />
          ) : (
            <span
              className={styles.titleName}
              title={data.fileName || undefined}
              onDoubleClick={(event) => {
                // 原位编辑，不触发节点双击居中放大
                event.stopPropagation();
                if (!data.onTitleChange) return;
                setNameDraft(data.fileName ?? '');
                setNameError('');
                setNameEditing(true);
              }}
            >
              {data.fileName || (isEmptyShell ? (data.mediaType === 'video' ? '视频节点' : data.mediaType === 'audio' ? '音频节点' : '图片节点') : '')}
            </span>
          )}
          {data.complianceBusy ? (
            <span className={`nodrag nopan ${styles.complianceBadge}`} title="校验中">
              <span className={styles.complianceSpinner} />
            </span>
          ) : data.compliancePassed ? (
            <span className={`nodrag nopan ${styles.complianceBadge}`} title="校验通过，可用于seedance视频生成">
              <img src="/success.png" alt="" />
            </span>
          ) : data.complianceFailed ? (
            <span className={`nodrag nopan ${styles.complianceFailedText}`} title="seedance合规校验失败，不可用于视频生成">
              审核失败
            </span>
          ) : null}
        </div>
        {/* IKJ7UI：样片/成片身份角标已迁入视频画面内右上角（ADR-0119 定稿，v3 原型深色
            玻璃胶囊），标题行不再挂卡外徽标；「已用 N 积分」不进角标（历史记录与详情已有）。 */}
        <span className={styles.titleMeta} title={titleMeta || undefined}>{titleMeta}</span>
        {/* IKIZQE：样片卡标题行「生成 1080P 成片」——两阶段链式动作唯一入口（父规格「交互」）。
            点击前展示成片预计积分，点击直接提交无二次确认；提交中/生成中/核对中/无报价均禁用。
            IKJ7UI：expired（过期/缺可信截止）整钮不渲染——死按钮没有行动价值，过期信息由画面内
            角标表达，恢复靠点卡重新编辑后从面板重发。由 CanvasPage 渲染期注入 finalizeCta
            派生状态（不持久化）。 */}
        {data.finalizeCta && data.finalizeCta.phase !== 'expired' && (() => {
          const cta = data.finalizeCta;
          const disabled = cta.phase !== 'ready';
          const label = cta.phase === 'running'
            ? '成片生成中…'
            : cta.phase === 'checking'
              ? '状态核对中…'
              : typeof cta.credits === 'number'
                ? `生成 1080P 成片 · ${cta.credits} 积分`
                : '生成 1080P 成片';
          const title = cta.phase === 'ready'
            ? `生成 1080P 成片，预计消耗 ${cta.credits} 积分（成片另行计费）`
            : cta.phase === 'loading'
              ? '正在获取成片报价'
              : cta.phase === 'running'
                ? '成片生成中'
                : cta.phase === 'checking'
                  ? '上次提交结果不明，正在核对，请勿重复提交'
                  : '暂不能生成成片（无报价或已有成片任务）';
          return (
            <button
              type="button"
              className={`nodrag nopan ${styles.finalizeCta}`}
              data-testid="finalize-cta"
              disabled={disabled}
              title={title}
              onClick={(event) => {
                event.stopPropagation();
                if (disabled) return;
                data.onFinalizeSample?.(id);
              }}
            >
              {label}
            </button>
          );
        })()}
      </div>
      {/* 「输入已更新」徽标：点击在下方弹出操作，默认「更新生成」原位重跑最新输入。
          放标题行外层避免 titleRow overflow 裁剪。 */}
      {data.inputStale === true && (
        <div ref={staleMenuRef} className={`nodrag nopan ${styles.inputStaleWrap}`}>
          <button
            type="button"
            className={styles.inputStaleLabel}
            data-testid="input-stale-badge"
            title="输入已更新：来源文本已修改"
            aria-haspopup="menu"
            aria-expanded={staleMenuOpen || undefined}
            onClick={(event) => {
              event.stopPropagation();
              setStaleMenuOpen((open) => !open);
            }}
          >
            输入已更新
            <ChevronDown size={12} strokeWidth={2} />
          </button>
          {staleMenuOpen && (
            <div className={styles.inputStaleMenu} role="menu" data-testid="input-stale-menu">
              <button
                type="button"
                role="menuitem"
                className={styles.inputStaleMenuItem}
                data-testid="input-stale-update-generate"
                disabled={isGenerating}
                title={isGenerating ? '正在生成中' : '在当前节点用最新输入重新生成'}
                onClick={(event) => {
                  event.stopPropagation();
                  if (isGenerating) return;
                  setStaleMenuOpen(false);
                  data.onUpdateGenerate?.(id);
                }}
              >
                <RefreshCw size={14} strokeWidth={2} />
                <span>更新生成</span>
              </button>
            </div>
          )}
        </div>
      )}
      {/* IKFR4X 持续选取会话勾选标识：已并入当前目标的来源节点，卡片右上角绿底白勾（纯展示不挡点击） */}
      {data.pickMarked === true && (
        <span
          className={`nodrag nopan ${styles.pickMarkedBadge}`}
          data-testid="pick-mark-badge"
          title="已加入当前参考"
        >
          <Check size={12} strokeWidth={3} />
        </span>
      )}
      {nameError && <div role="alert" className="nodrag nopan">{nameError}</div>}
      {/* 悬停预览指针只挂内容区（IKJ7RS）：标题行（双击改名/合规角标）不触发播放 */}
      <div
        className={`${styles.contentCard} ${isAudio ? styles.audioCard : ''}`}
        data-testid="media-content"
        style={{ width: contentBox.width, height: contentBox.height }}
        onPointerEnter={handleContentPointerEnter}
        onPointerLeave={handleContentPointerLeave}
      >
        {showTargetHandle && (
          <Handle type="target" position={Position.Left} className={styles.handle} style={{ ...HANDLE_STYLE, left: '-16px' }}>
          <HandlePlus />
        </Handle>
        )}
        {isEmptyShell ? (
          <button
            type="button"
            className={`${styles.emptyShell} nodrag nopan`}
            onClick={() => shellFileRef.current?.click()}
          >
            <Icon size={22} strokeWidth={1.8} color="#888" />
            <span className={styles.emptyShellHint}>点击上传素材</span>
            <input
              ref={shellFileRef}
              type="file"
              hidden
              accept={
                data.mediaType === 'video'
                  ? 'video/*'
                  : data.mediaType === 'audio'
                    ? 'audio/*'
                    : 'image/*'
              }
              onChange={(e) => {
                acceptShellFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </button>
        ) : isDraft || (isGenDone && !hasMediaSrc) || data.assetMissing || (isGenerating && !hasMediaSrc) || (isChecking && !hasMediaSrc) ? (
          renderPlaceholder()
        ) : isAudio ? (
          <AudioPlayer
            ref={trimSeekBridge.playerRef}
            src={data.src || ''}
            fileName={data.fileName}
            duration={typeof data.duration === 'number' ? data.duration : undefined}
            onDownload={() => data.onDownload?.(id)}
            speedEditing={data.speedEditing != null}
            speedFactor={data.speedEditing && data.speedEditing !== true ? data.speedEditing.speed : undefined}
            trimSelection={data.trimEditing ? data.trimEditing.selection : null}
            trimOverlay={
              data.trimEditing ? (
                <AudioTrimOverlay
                  selection={data.trimEditing.selection}
                  duration={data.trimEditing.duration}
                  onSelectionChange={data.trimEditing.onSelectionChange}
                  onSeekStart={trimSeekBridge.onSeekStart}
                  onSeek={trimSeekBridge.onSeek}
                  onSeekEnd={(time) => trimSeekBridge.onSeekEnd(time, data.trimEditing?.selection.end)}
                />
              ) : undefined
            }
          />
        ) : data.mediaType === 'video' ? (
          <>
            {/* 透明结果卡棋盘格垫底层（IKHKAC）：垫在 video 之下的静态棋盘格，透明 WebM 的
                透明区域透出格纹，一眼认出这是可合成的透明素材（视觉语言沿用图片抠图结果卡
                imageCutout 先例）；仅 transparentOutput 标记卡渲染——标记在任务完成回填时
                按产物格式冻结（WEBM 透明=true，MP4 纯色不设），aria-hidden 纯视觉 */}
            {data.transparentOutput === true && (
              <div className={styles.cutoutCheckerboard} aria-hidden data-testid="video-transparent-checkerboard" />
            )}
            {videoError ? (
              /* 播放失败兜底：双源全部失败（如 Windows/Edge 无 HEVC 扩展）或解码错误时，
                 以明确提示 + 新窗口打开替代无声黑屏；src 变化即复位（见 setVideoError 重置 effect） */
              <div className={styles.genBox} data-testid="video-error-box">
                <span className={styles.genFailText} title={videoLoadErrorMessage(videoError.code)}>
                  {videoLoadErrorMessage(videoError.code)}
                </span>
                {data.src && (
                  <a
                    className={styles.genBtn}
                    href={data.src}
                    target="_blank"
                    rel="noreferrer"
                    style={{ textDecoration: 'none', display: 'inline-block' }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    新窗口打开
                  </a>
                )}
              </div>
            ) : (
              /* 双源播放：主源编码未知不标 codecs，H.264 兜底标 avc1——主源解码失败
                 （如 H.265 遇无 HEVC 扩展的 Windows/Edge）浏览器自动落到次选 source。
                 合成层放在包裹层：直接打在 <video> 上会穿透画布工具栏/小地图的命中。
                 IKI5YM：video 不挂 nodrag（画面区回归节点拖拽路径，对齐图片卡）、
                 去原生 controls（shadow DOM 无法只对画面区放行指针）；播放能力由
                 VideoPlayerControls 自绘控件承担，其交互子元素自带 nodrag。 */
              <div className={styles.mediaVideoLayer}>
                {videoControlsArmed ? (
                  <>
                    <video
                      ref={videoRef}
                      className={styles.mediaVideo}
                      playsInline
                      preload="metadata"
                      disablePictureInPicture
                      draggable={false}
                      onLoadedMetadata={handleVideoReady}
                      onLoadedData={handleVideoReady}
                      onError={handleVideoError}
                      onMouseDown={handleVideoPressDown}
                      onClick={handleVideoClick}
                    >
                      {videoSourceList(data.src, data.srcH264).map((source) => (
                        <source key={source.src} src={source.src} type={source.type} />
                      ))}
                    </video>
                    <VideoPlayerControls
                      videoRef={videoRef}
                      duration={typeof data.duration === 'number' ? data.duration : undefined}
                    />
                  </>
                ) : (
                  <>
                    <canvas ref={videoPosterRef} className={styles.mediaVideoPoster} aria-hidden />
                    {/* 悬停预览播放层（IKJ7RS）：悬停开播时把离屏解码 video 命令式移入本层
                        （点选过渡同一元素续播的承载）。无控件纯展示、指针穿透
                        （pointer-events:none，!832 合同同款不打 transform），空层零视觉零命中。 */}
                    <div
                      ref={hoverPreviewHostRef}
                      className={styles.mediaHoverPreviewLayer}
                      aria-hidden
                      data-testid="video-hover-preview"
                    />
                    {/* 收养会话自绘控件（IKI5YM 审查修订）：点选过渡后原生控件不再回归，
                        树内同款控件经稳定 ref（adoptedVideoRef）叠加到悬停会话元素上——
                        会话元素在播放层内、不在 React ref 里，hoverPlaying 占屏阻断树内布防
                        （videoControlsArmed 恒 false），收养期即本分支唯一控件 */}
                    {selected && hoverPlaying && adoptedVideoRef && (
                      <VideoPlayerControls
                        videoRef={adoptedVideoRef}
                        duration={typeof data.duration === 'number' ? data.duration : undefined}
                      />
                    )}
                  </>
                )}
              </div>
            )}
            {/* 智能抠像透明结果卡角标（IKHKAC，形态取交互验收基准原型 done 态）：视频区
                左下角半透明胶囊标注「透明背景 · WEBM」，与棋盘格一起标识透明产物；
                仅 transparentOutput 标记卡渲染，MP4 纯色结果不渲染 */}
            {data.transparentOutput === true && (
              <span className={styles.transparentTag} data-testid="video-transparent-tag">
                透明背景 · WEBM
              </span>
            )}
            {/* IKJ7UI（ADR-0119）：样片/成片身份角标迁入画面内右上角（v3 原型深色玻璃胶囊
                定稿）。仅成功态渲染（genStatus == null 且非 draft，口径同 CanvasPage 的
                finalizeCtaByNodeId 派生门）——生成中靠自动命名「样片生成中」识别、失败卡
                不挂角标；「已用 N 积分」不进角标（历史记录与详情已有）。样片角标成功态
                「样片 480P · 截止 MM-DD HH:mm」（信息蓝点缀），过期/缺可信截止整条转警告橙
                「样片 480P · 已过期」（缺截止视同过期，ADR-0119 不新增第三态）；成片角标
                「成片 1080P」紫色文字点缀。位置/配色以 v3 原型 CSS 为准，pointer-events:none
                同 transparentTag 先例——点击/播放操作仍落到视频本体。 */}
            {data.videoStage === 'sample' && data.genStatus == null && data.draft !== true && (() => {
              const label = sampleDeadlineLabel(data.finalizeDeadlineAt);
              const expired = !label || sampleDeadlineExpired(data.finalizeDeadlineAt);
              return (
                <span
                  className={expired ? `${styles.stageTag} ${styles.stageTagExpired}` : styles.stageTag}
                  data-testid="video-sample-badge"
                  title={expired
                    ? (data.finalizeDeadlineAt == null
                      ? '样片缺少可信创建时间，无法生成成片；样片仍可预览、下载'
                      : '转成片期限已过，样片仍可预览、下载')
                    : `转成片截止 ${label}；成片另行计费`}
                >
                  <Clock size={11} strokeWidth={2} aria-hidden />
                  {expired ? '样片 480P' : <span className={styles.stageTagAcc}>样片 480P</span>}
                  <span className={styles.stageTagDim}>{expired ? '· 已过期' : `· 截止 ${label}`}</span>
                </span>
              );
            })()}
            {data.videoStage === 'final' && data.genStatus == null && data.draft !== true && (
              <span
                className={`${styles.stageTag} ${styles.stageTagFinal}`}
                data-testid="video-final-badge"
                title="从样片生成的 1080P 成片"
              >
                <Film size={11} strokeWidth={2} aria-hidden />
                成片 1080P
              </span>
            )}
            {/* 去字幕编辑态框层（IKGZ83）：半透明矩形描边渲染 + 拉框指针接管，
                仅正常视频内容区叠加（编辑态存在即视频已在当前帧暂停） */}
            {data.subtitleEraseEditing && (
              <SubtitleEraseBoxesLayer
                boxes={data.subtitleEraseEditing.boxes}
                liveBox={data.subtitleEraseEditing.liveBox}
                displayWidth={contentBox.width}
                displayHeight={contentBox.height}
                onBoxStart={data.subtitleEraseEditing.onBoxStart}
                onBoxMove={data.subtitleEraseEditing.onBoxMove}
                onBoxEnd={data.subtitleEraseEditing.onBoxEnd}
              />
            )}
            {/* 音视频分离编辑态锁定层（IKH28U）：透明全覆盖接管指针（无框层，先例=去字幕
                框层全覆盖接管）——编辑态期间播放控制不可达、点视频不响应播放操作；
                退出（标记移除）即恢复播放控制。nodrag/nopan 同框层口径（层上拖不动卡/画布） */}
            {data.splitEditing && (
              <div
                className="nodrag nopan"
                data-testid="split-lock-layer"
                style={{ position: 'absolute', inset: 0, zIndex: 5, cursor: 'default', touchAction: 'none' }}
              />
            )}
          </>
        ) : (
          <>
            {/* 抠图结果卡棋盘格垫底层（IKGXMT）：垫在 img 之下的静态棋盘格，透出透明 png 的
                透明区域（规格故事 21）；仅 imageCutout 标记卡渲染，aria-hidden 纯视觉 */}
            {data.imageCutout && (
              <div className={styles.cutoutCheckerboard} aria-hidden data-testid="cutout-checkerboard" />
            )}
            <img
              className={styles.mediaImage}
              src={resolveMediaSrc(data.src)}
              crossOrigin={remoteImageCrossOrigin(data.src)}
              alt={data.fileName || 'image'}
              draggable={false}
              onLoad={handleImageLoad}
              style={isSelect ? undefined : { pointerEvents: 'none' }}
            />
            {/* 擦除编辑态遮罩层（IKGOTB）：棋盘格渲染+指针接管，仅正常图片内容区叠加 */}
            {data.eraseEditing && (
              <EraseMaskLayer
                ops={data.eraseEditing.ops}
                liveOp={data.eraseEditing.liveOp}
                displayWidth={contentBox.width}
                displayHeight={contentBox.height}
                onStrokeStart={data.eraseEditing.onStrokeStart}
                onStrokeMove={data.eraseEditing.onStrokeMove}
                onStrokeEnd={data.eraseEditing.onStrokeEnd}
              />
            )}
          </>
        )}
        {isGenerating && hasMediaSrc && (
          <div className={`nodrag nopan ${styles.regenOverlay}`} data-testid="regen-overlay">
            <span className={styles.regenSpinner} />
            <span className={styles.regenText}>
              重新生成中{typeof data.progress === 'number' ? ` ${data.progress}%` : ''}
            </span>
            {!hideCancel && (
              <button className={styles.regenCancel} onClick={() => data.onCancelJob?.(id)}>
                取消
              </button>
            )}
          </div>
        )}
        {/* IKDMQV：重新生成失败/取消的成品卡——旧素材继续显示，底部角标呈现原因与重试。
            重试沿用失败任务冻结快照（retry 接口）；修改参数或引用后新生成走面板「生成」（新任务新快照）。 */}
        {isGenDone && hasMediaSrc && (
          <div className={`nodrag nopan ${styles.regenOverlay}`} data-testid="fail-overlay">
            <span className={styles.failOverlayText} title={failHeadline}>{failHeadline}</span>
            {data.genStatus === 'failed'
              && (!isMediaExtraction || data.mediaExtract != null)
              && (!isAudioTrimCard || data.audioTrim != null)
              && frameInterpolationRetryable && (
              <button className={styles.regenCancel} onClick={() => data.onRetryJob?.(id)}>
                重试
              </button>
            )}
          </div>
        )}
        {showSourceHandle && (
        <Handle type="source" position={Position.Right} className={styles.handle} style={{ ...HANDLE_STYLE, right: '-16px' }}>
        <HandlePlus />
      </Handle>
        )}
      </div>

      {contextMenu && (
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={isDraft
            ? [
                { key: 'duplicate', label: '创建副本' },
                { key: 'delete', label: '删除', danger: true },
              ]
            : [
                { key: 'chat', label: '添加到聊天' },
                ...(isAudio
                  ? []
                  : [{
                      key: 'compliance',
                      label: 'Seedance合规校验',
                      loading: data.complianceBusy,
                      disabled: data.assetMissing === true,
                    }]),
                { key: 'duplicate', label: '创建副本' },
                { key: 'delete', label: '删除', danger: true },
              ]}
          onClose={() => setContextMenu(null)}
          onSelect={(key) => {
            setContextMenu(null);
            if (key === 'chat') handleAddToChat();
            else if (key === 'compliance') data.onComplianceCheck?.(id);
            else if (key === 'duplicate') handleDuplicate();
            else if (key === 'delete') handleDelete();
          }}
        />
      )}
    </div>
  );
}
