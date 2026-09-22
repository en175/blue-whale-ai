/* ============================================
 * MediaNodeToolbar 媒体卡悬浮工具条（IKGYYD 自 MediaNode/index.tsx 迁出）：
 * 按钮构成/顺序/文案/置灰门槛除 IKH3WE 撤除的三个生成类按钮外与迁移前一致；DOM 迁出节点卡后由通用钉屏幕容器
 * NodeFollowToolbar 承载（画布缩放层之外、任何缩放级别屏幕尺寸恒定、拖动/平移缩放实时跟随）。
 * 显隐分工：「唯一选中 + 画布无多选」在 NodeFollowToolbar 容器（useSoloNodeSelected 口径不变）；
 * 本组件承担数据条件（生成流程卡 / 素材缺失 / 空壳上传卡不显）。
 * 工具条不再承载生成类入口（IKH3WE 撤除「重新编辑」「生成图片」「生成视频」）：
 * 派生新卡唯一路径 = 拖线落空白出类型菜单，原卡重跑唯一路径 = 点卡片打开绑定面板。
 * IKH3XZ 五画质工具横排常显（ADR-0107）：高清/扩图/裁切/擦除/抠图离开「高清 ▾」下拉，
 * 直接以图标+文字按钮排在工具条上（复用 toolBtn）；「高清」图标 Expand→ZoomIn（与扩图
 * Maximize2 并排撞脸）；点击派发、门槛预检、建卡口径不变，只改承载形态。触发钮最近工具
 * 记忆（recentQualityTool）与悬浮展开/直启路径整套退役；视频卡「智能去字幕 ▾」下拉不受影响。
 * 工具条 DOM 不再位于节点卡内：点击按钮天然不触发节点拖拽/选中变化（原 nodrag/nopan 与
 * stopPropagation 防护随迁移移除），点击也不落在 React Flow pane 上（不触发 PaneClick）。
 * IKH8Q3（ADR-0109）音频卡横矩形改版：音频分支「详情+下载」改为「截取、调速、混合、
 * 音视频合成、转码」五功能占位钮 + 竖直分隔线 + 下载。IKHB6Y 首位「截取」从占位点亮为
 * 可点入口（门槛见 audioTrim.ts：音频 URL 缺失或时长缺失/为 0 置灰，不照搬家族
 * 「数据缺失不拦」口径；点击派发 onTrimAudio，编辑态行为归 IKHB7A），其余四钮
 * （调速/混合/音视频合成/转码）维持置灰占位「即将上线」，各功能交互由后续独立任务
 * 逐个点亮；详情钮随改版对音频退役（信息稀薄，右键菜单与双击重命名已覆盖），
 * 图片/视频分支的详情不变；音频不出现「替换」入口；@（mention）对音频保持隐藏。
 * IKH8BJ 视频卡追加「场景切分」入口：图标+文字单按钮（无下拉），形态同「音视频分离」，
 * 落其之后、分隔线之前；置灰门槛见 sceneSplit.ts（未关联资产 / 时长超 2 小时且有时长数据），
 * 点击派发 onSceneSplit 进入编辑态（编辑态本体由 IKH8BR 交付）。
 * IKHA2E「音视频分离」改悬停下拉（ADR-0110）：原单按钮升为 AudioVideoSplitMenu（悬停展开/
 * 移出延时关/点触发钮直启首项，形态同「智能去字幕 ▾」）；菜单两项 = 首项原「音视频分离」
 * 直进（功能不改名）+ 次项「人声背景分离」，次项置灰门槛见 vocalSplit.ts（未关联资产）、
 * 点击派发 onVocalBackgroundSplit 进入编辑态（编辑态本体由 IKHA2W 交付）。
 * IKHK7N 视频卡追加「智能抠像 ▾」下拉入口（ADR-0112）：模式选择前置到入口下拉
 * （SmartMattingMenu，形态同「智能去字幕 ▾」家族），落「场景切分」之后、分隔线之前；
 * 两项纯文字「人像抠像」「绿幕抠像」分别派发 onSmartMatting(id, mode) 进入编辑态
 * （编辑态本体由 IKHK9N 交付）；置灰门槛见 smartMatting.ts（未关联资产 / 时长超
 * 10 分钟且有时长数据，缺失放行），触发钮点击直启首项「人像抠像」。
 * IKHW5C（父单 IKHVYO）音频卡第二钮「调速」点亮（ADR-0109 第二钮）：自占位数组移出
 * 单独渲染接门槛与回调（形态同「截取」钮 IKHB6Y 先例：图标+文字、aria-disabled 置灰、
 * 点击守卫后派发 onAudioSpeed，编辑态本体归 IKHW5S）；置灰唯一条件 = 音频 URL 与
 * assetId 皆缺失（audioSpeed.ts，悬停「音频不可用，无法调速」；时长缺失不拦，无截取
 * 的时长门槛），混合/音视频合成/转码三钮维持置灰占位「即将上线」不变。
 * IKHLKR 视频卡首位「HD」单按钮升为「高清 ▾」下拉（FrameInterpolationMenu，ADR-0113）：
 * 首项「HD 高清」直启原链路零变化，次项「插帧」派发 onFrameInterpolation 建插帧草稿卡
 * （发送闭环由 IKHLKX 交付）。门槛分两层：整钮置灰只看未关联资产（triggerDisabledReason），
 * HD 的分辨率上下限降为「HD 高清」项级（videoEnhanceDisabledReason）——源视频超上限时
 * HD 项置灰而插帧可用；触发钮文字是「高清」，HD 项被拦时点击不派发（不自动改派插帧）。
 * ============================================ */
import { useCallback } from 'react';
import { Info, Download, AtSign, ZoomIn, Eraser, Crop, Maximize2, WandSparkles, Scissors, Gauge, Layers, Clapperboard, Repeat, Film, type LucideIcon } from 'lucide-react';
import { outpaintGateReason } from '../../imageOutpaint';
import { imageEraseGateReason } from '../../imageErase';
import { imageCutoutGateReason } from '../../imageCutout';
import { videoSubtitleEraseGateReason } from '../../videoSubtitleErase';
import { AUDIO_VIDEO_SPLIT_ENTRY_HINT, audioVideoSplitGateReason } from '../../audioVideoSplit';
import { audioTrimGateReason } from '../../audioTrim';
import { audioMixSourceError } from '../../audioMix';
import { audioSpeedGateReason } from '../../audioSpeed';
import { SCENE_SPLIT_ENTRY_HINT, sceneSplitGateReason } from '../../sceneSplit';
import {
  SMART_MATTING_ENTRY_HINT,
  SMART_MATTING_GREENSCREEN_HINT,
  SMART_MATTING_PORTRAIT_HINT,
  smartMattingGateReason,
} from '../../smartMatting';
import { VIDEO_ENHANCE_ENTRY_HINT, videoEnhanceGateReason } from '../../videoEnhance';
import { FRAME_INTERPOLATION_ENTRY_HINT, frameInterpolationGateReason } from '../../frameInterpolation';
import { mediaNodeToolbarVisibility, mediaCardToolbarVisible } from './toolbarVisibility';
import SubtitleEraseMenu, { type SubtitleEraseMenuItem } from './SubtitleEraseMenu';
import AudioVideoSplitMenu, { type AudioVideoSplitMenuItem } from './AudioVideoSplitMenu';
import SmartMattingMenu, { type SmartMattingMenuItem } from './SmartMattingMenu';
import FrameInterpolationMenu, { type FrameInterpolationMenuItem } from './FrameInterpolationMenu';
import type { MediaNodeData } from './index';
import styles from './index.module.css';

/** 画质工具按钮配置（IKH3XZ 自 ImageQualityMenu.tsx 迁入：原「高清 ▾」下拉退役，五工具横排常显）。
 *  id/label/图标/可用性判定由宿主数组驱动；置灰口径不变——aria-disabled 置灰保持渲染不隐藏，
 *  title 悬停展示不可用原因，点击不派发。 */
interface QualityToolItem {
  /** 工具 id（'enhance' / 'outpaint' / 'crop' / 'erase' / 'cutout'） */
  id: string;
  label: string;
  icon: LucideIcon;
  /** 可用时的悬停说明 */
  hint?: string;
  /** 置灰原因（null=可用；置灰项 title 展示原因且点击不派发，口径同 ImageEnhanceDialog guarded） */
  disabledReason: string | null;
  onSelect: () => void;
}

interface MediaNodeToolbarProps {
  id: string;
  data: MediaNodeData;
}

/** 音频卡三占位钮（IKH8Q3 剩余项，ADR-0109；IKHW5C 起「调速」移出点亮不在本数组）：
 *  置灰占位，无门槛、无回调依赖，故为模块级静态配置（区别于画质横排的组件内数组）；
 *  「截取」（IKHB6Y）与「调速」（IKHW5C）已点亮单独渲染各接门槛与回调；
 *  图标按序：剪刀（截取）、仪表盘（调速）、层叠（混合）、场记板（音视频合成）、
 *  循环箭头（转码），形态沿用画质家族「图标 + 文字」横排口径（ADR-0107）。 */
const AUDIO_TOOL_PLACEHOLDER_HINT = '即将上线';
const audioToolItems: Array<{ id: string; label: string; icon: LucideIcon }> = [
  { id: 'compose', label: '音视频合成', icon: Clapperboard },
  { id: 'transcode', label: '转码', icon: Repeat },
];

export default function MediaNodeToolbar({ id, data }: MediaNodeToolbarProps) {
  const handleVideoSubtitleEraseSmart = useCallback(
    () => data.onVideoSubtitleErase?.(id, 'smart'),
    [data, id],
  );
  const handleVideoSubtitleEraseBox = useCallback(
    () => data.onVideoSubtitleErase?.(id, 'box'),
    [data, id],
  );
  const handleEnhanceImage = useCallback(() => data.onEnhanceImage?.(id), [data, id]);
  const handleEraseImage = useCallback(() => data.onEraseImage?.(id), [data, id]);
  const handleOutpaintImage = useCallback(() => data.onOutpaintImage?.(id), [data, id]);
  /** 扩图可用性预检（打开菜单时按当前源图快照判定）：置灰并悬停说明原因 */
  const outpaintDisabledReason = outpaintGateReason(
    typeof data.width === 'number' ? data.width : undefined,
    typeof data.height === 'number' ? data.height : undefined,
    typeof data.size === 'number' ? data.size : undefined,
  );
  /** 「智能去字幕 ▾」整卡可用性预检（IKGZ82，IKH3OU 起服务下拉菜单）：分辨率超 2K 或
   *  时长超 10 分钟时整钮与两个菜单项一并置灰并悬停原因；宽高/时长缺失不拦（null 放行，
   *  后端按权威数据复核）。可用态触发钮无默认悬停文案（旧效果边界句随「全画面文字」
   *  开关废除，ADR-0104），置灰态在触发钮与两项各自 title 上展示。 */
  const videoSubtitleEraseDisabledReason = videoSubtitleEraseGateReason(data);
  const handleCropImage = useCallback(() => data.onCropImage?.(id), [data, id]);
  const handleCutoutImage = useCallback(() => data.onCutoutImage?.(id), [data, id]);
  /** 音视频分离（IKH28U 入口 / IKHA2E 改下拉触发钮）：点击触发钮直启首项「音视频分离」
   *  进入编辑态，原单按钮直启链路零变化；置灰预检见 audioVideoSplit.ts（assetId 缺失唯一置灰） */
  const handleAudioVideoSplit = useCallback(() => data.onAudioVideoSplit?.(id), [data, id]);
  const audioVideoSplitDisabledReason = audioVideoSplitGateReason(data);
  /** 音频截取（IKHB6Y，父单 IKHB08）：首位「截取」点亮为可点入口，点击派发 onTrimAudio
   *  进入截取编辑态（编辑态行为归 IKHB7A，本票只透出回调）；置灰预检见 audioTrim.ts
   *  （音频 URL 缺失或时长缺失/为 0 置灰——手柄时间换算硬性依赖时长，缺失即拦，
   *  不照搬家族「数据缺失不拦」口径） */
  const handleTrimAudio = useCallback(() => data.onTrimAudio?.(id), [data, id]);
  const audioTrimDisabledReason = audioTrimGateReason(data);
  const audioMixDisabledReason = audioMixSourceError({ id, type: 'mediaNode', position: { x: 0, y: 0 }, data: data as unknown as Record<string, unknown> });
  /** 音频调速（IKHW5C，父单 IKHVYO）：第二钮「调速」点亮，点击派发 onAudioSpeed 进入
   *  调速编辑态骨架（编辑态本体归 IKHW5S）；置灰预检见 audioSpeed.ts（音频 URL 与
   *  assetId 皆缺失唯一置灰——悬停「音频不可用，无法调速」；时长缺失不拦，无截取
   *  的时长门槛） */
  const handleAudioSpeed = useCallback(() => data.onAudioSpeed?.(id), [data, id]);
  const audioSpeedDisabledReason = audioSpeedGateReason(data);
  /** 人声背景分离（IKHA2E 挂接点）：「音视频分离 ▾」下拉第二项派发，本票仅交付点击派发
   *  挂接点，编辑态本体由后续票实现——回调未注入时点击安全 no-op；置灰门槛同源整卡 */
  const handleVocalBackgroundSplit = useCallback(() => data.onVocalBackgroundSplit?.(id), [data, id]);
  /** 场景切分（IKH8BJ）：点击进入场景切分编辑态（编辑态本体归 IKH8BR）；
   *  置灰预检见 sceneSplit.ts（未关联资产 / 时长超 2 小时且有时长数据，缺失放行） */
  const handleSceneSplit = useCallback(() => data.onSceneSplit?.(id), [data, id]);
  const sceneSplitDisabledReason = sceneSplitGateReason(data);
  /** 智能抠像（IKHK7N）：菜单项与触发钮直启派发 onSmartMatting 进入抠像编辑态
   *  （编辑态本体归 IKHK9N，本票只接通入口事件）；置灰预检见 smartMatting.ts
   *  （未关联资产 / 时长超 10 分钟且有时长数据，缺失放行） */
  const handleSmartMattingPortrait = useCallback(
    () => data.onSmartMatting?.(id, 'portrait'),
    [data, id],
  );
  const handleSmartMattingGreenscreen = useCallback(
    () => data.onSmartMatting?.(id, 'greenscreen'),
    [data, id],
  );
  const smartMattingDisabledReason = smartMattingGateReason(data);
  /** 视频 HD 高清（IKH3VG）：点击在源卡右侧建 HD 草稿卡并弹出 HD 面板；置灰预检见
   *  videoEnhance.ts（未关联资产 / 短长边超上限 / 短边不足 360，宽高缺失放行） */
  const handleVideoEnhance = useCallback(() => data.onVideoEnhance?.(id), [data, id]);
  const videoEnhanceDisabledReason = videoEnhanceGateReason(data);
  /** 视频插帧（IKHLKR，ADR-0113）：「高清 ▾」下拉第二项——在源卡右侧建插帧草稿卡并弹出
   *  插帧面板；门槛见 frameInterpolation.ts（未关联资产唯一前置，不做时长/源帧率前置） */
  const handleFrameInterpolation = useCallback(() => data.onFrameInterpolation?.(id), [data, id]);
  /** 整钮与插帧项共用门槛（未关联资产，两功能公共交集） */
  const frameInterpolationDisabledReason = frameInterpolationGateReason(data);
  const handleDownload = useCallback(() => data.onDownload?.(id), [data, id]);
  const handleShowDetails = useCallback(() => data.onShowDetails?.(id), [data, id]);
  const handleMention = useCallback(() => data.onAddToChat?.(id), [data, id]);

  const toolbar = mediaNodeToolbarVisibility(data.mediaType);
  /** 画质工具按钮配置（IKGOT7 数组配置驱动，IKH3XZ 起横排直渲染）：顺序高清、扩图、裁切、擦除、抠图；
   *  擦除按 imageErase 门槛预检置灰（title 悬停原因，尺寸 null 不拦）、扩图按
   *  outpaintGateReason 门槛预检置灰、裁切无置灰门槛恒可用；
   *  抠图（IKGXLT/IKGXMT）在「擦除」之后追加，按 imageCutout 门槛预检置灰（无最小边判定，
   *  通用场景上限 10240/6000/40MP + 30MB；点击经 onCutoutImage 进入抠图工具栏） */
  const qualityToolItems: QualityToolItem[] = [
    {
      id: 'enhance',
      label: '高清',
      icon: ZoomIn,
      hint: '在右侧新建高清放大草稿卡',
      disabledReason: null,
      onSelect: handleEnhanceImage,
    },
    {
      id: 'outpaint',
      label: '扩图',
      icon: Maximize2,
      hint: '进入扩图模式，拖动边框向外扩展画面',
      disabledReason: outpaintDisabledReason,
      onSelect: handleOutpaintImage,
    },
    {
      id: 'crop',
      label: '裁切',
      icon: Crop,
      hint: '拖动裁切框，裁掉边缘保留选定区域',
      disabledReason: null,
      onSelect: handleCropImage,
    },
    {
      id: 'erase',
      label: '擦除',
      icon: Eraser,
      hint: '涂抹或框选抹掉图中不要的内容',
      disabledReason: imageEraseGateReason(data),
      onSelect: handleEraseImage,
    },
    {
      id: 'cutout',
      label: '抠图',
      icon: WandSparkles,
      hint: '自动识别主体并移除背景',
      disabledReason: imageCutoutGateReason(data),
      onSelect: handleCutoutImage,
    },
  ];
  /** 「智能去字幕 ▾」下拉菜单项（IKH3OU，ADR-0104 模式前置到入口）：两项纯文字、
   *  分别直启智能模式与框选模式会话，会话内不互切；门槛同源整卡预检（超 2K/超 10 分钟
   *  两项一并置灰，点击无效），各项 title 恒为自己的 hint——置灰时仍能看两项说明，
   *  以理解置灰是整卡门槛而非某一模式不可用（规格故事 7）。 */
  const subtitleEraseMenuItems: SubtitleEraseMenuItem[] = [
    {
      id: 'smart',
      label: '智能去字幕',
      hint: '自动擦除画面下半字幕',
      disabledReason: videoSubtitleEraseDisabledReason,
      onSelect: handleVideoSubtitleEraseSmart,
    },
    {
      id: 'box',
      label: '框选去字幕',
      hint: '拉框指定要擦的区域',
      disabledReason: videoSubtitleEraseDisabledReason,
      onSelect: handleVideoSubtitleEraseBox,
    },
  ];

  /** 「音视频分离 ▾」下拉菜单项（IKHA2E）：首项保持原名「音视频分离」、直启原链路不变
   *  （点击触发钮=直启首项）；第二项「人声背景分离」仅派发挂接点（编辑态本体归后续票）；
   *  门槛同源整卡预检（未关联资产唯一置灰，点击无效但悬停仍可展开看两项说明与置灰原因），
   *  各项 title 恒为自己的 hint。 */
  const audioVideoSplitMenuItems: AudioVideoSplitMenuItem[] = [
    {
      id: 'split',
      label: '音视频分离',
      hint: AUDIO_VIDEO_SPLIT_ENTRY_HINT,
      disabledReason: audioVideoSplitDisabledReason,
      onSelect: handleAudioVideoSplit,
    },
    {
      id: 'vocalBackground',
      label: '人声背景分离',
      hint: '把人声与背景音分离为多张音频卡',
      disabledReason: audioVideoSplitDisabledReason,
      onSelect: handleVocalBackgroundSplit,
    },
  ];

  /** 「智能抠像 ▾」下拉菜单项（IKHK7N，ADR-0112 模式前置到入口）：两项纯文字、
   *  分别直启人像/绿幕抠像编辑态（模式是发起前的分类问题，不进编辑态再选）；
   *  门槛同源整卡预检（未关联资产/超 10 分钟两项一并置灰，点击无效但悬停仍可展开
   *  看两项说明与置灰原因），各项 title 恒为自己的 hint（同去字幕规格故事 7 口径）。 */
  const smartMattingMenuItems: SmartMattingMenuItem[] = [
    {
      id: 'portrait',
      label: '人像抠像',
      hint: SMART_MATTING_PORTRAIT_HINT,
      disabledReason: smartMattingDisabledReason,
      onSelect: handleSmartMattingPortrait,
    },
    {
      id: 'greenscreen',
      label: '绿幕抠像',
      hint: SMART_MATTING_GREENSCREEN_HINT,
      disabledReason: smartMattingDisabledReason,
      onSelect: handleSmartMattingGreenscreen,
    },
  ];

  /** 「高清 ▾」下拉菜单项（IKHLKR，ADR-0113）：首位「HD 高清」直启原链路零变化
   *  （点击触发钮=直启首项），次项「插帧」为新增入口。**两层门槛分开**（家族差异）：
   *  整钮置灰只看未关联资产（frameInterpolationDisabledReason，经 triggerDisabledReason
   *  单传给组件），HD 的分辨率上下限从整钮降为『HD 高清』项级（videoEnhanceDisabledReason）；
   *  故源视频超上限时 HD 项置灰而插帧项仍可用——触发钮文字是「高清」，此时点击不派发。 */
  const videoEnhanceMenuItems: FrameInterpolationMenuItem[] = [
    {
      id: 'hd',
      label: 'HD 高清',
      hint: VIDEO_ENHANCE_ENTRY_HINT,
      disabledReason: videoEnhanceDisabledReason,
      onSelect: handleVideoEnhance,
    },
    {
      id: 'interpolation',
      label: '插帧',
      hint: FRAME_INTERPOLATION_ENTRY_HINT,
      disabledReason: frameInterpolationDisabledReason,
      onSelect: handleFrameInterpolation,
    },
  ];

  /* 数据门（同迁移前 MediaNode 内判定）：生成流程卡 / 素材缺失 / 空壳上传卡不显；
   *  谓词与 CanvasPage 显隐门共用（mediaCardToolbarVisible，IKGYYB 审查消双实现） */
  if (!mediaCardToolbarVisible(data)) return null;

  return (
    <div className={styles.toolbar}>
      {toolbar.videoEnhance && (
        <FrameInterpolationMenu
          items={videoEnhanceMenuItems}
          triggerDisabledReason={frameInterpolationDisabledReason}
        />
      )}
      {toolbar.videoSubtitleErase && (
        <SubtitleEraseMenu items={subtitleEraseMenuItems} />
      )}
      {toolbar.imageQuality && qualityToolItems.map((item) => {
        const Icon = item.icon;
        const disabled = item.disabledReason != null;
        return (
          <button
            key={item.id}
            type="button"
            className={styles.toolBtn}
            onClick={() => {
              if (disabled) return;
              item.onSelect();
            }}
            title={item.disabledReason ?? item.hint}
            aria-disabled={disabled || undefined}
            data-testid={`quality-tool-${item.id}`}
          >
            <Icon size={14} strokeWidth={2} />
            <span>{item.label}</span>
          </button>
        );
      })}
      {data.mediaType === 'video' && (
        <AudioVideoSplitMenu
          items={audioVideoSplitMenuItems}
          triggerHint={AUDIO_VIDEO_SPLIT_ENTRY_HINT}
        />
      )}
      {/* 音频卡「截取」入口（IKHB6Y）：从占位点亮为可点——aria-disabled 门槛置灰口径
          同画质横排（.toolBtn[aria-disabled='true']），置灰 title 悬停原因、可用态无
          默认悬停文案（口径同智能去字幕触发钮）；点击守卫后派发 onTrimAudio */}
      {toolbar.audioTools && (
        <button
          type="button"
          className={styles.toolBtn}
          onClick={() => {
            if (audioTrimDisabledReason !== null) return;
            handleTrimAudio();
          }}
          title={audioTrimDisabledReason ?? undefined}
          aria-disabled={audioTrimDisabledReason !== null || undefined}
          data-testid="audio-tool-trim"
        >
          <Scissors size={14} strokeWidth={2} />
          <span>截取</span>
        </button>
      )}
      {/* 音频卡「调速」入口（IKHW5C，父单 IKHVYO）：第二钮自占位点亮——形态与置灰口径
          同「截取」钮先例（aria-disabled 置灰保持渲染、置灰 title 悬停原因、可用态无
          默认悬停文案）；点击守卫后派发 onAudioSpeed，编辑态本体归 IKHW5S */}
      {toolbar.audioTools && (
        <button
          type="button"
          className={styles.toolBtn}
          onClick={() => {
            if (audioSpeedDisabledReason !== null) return;
            handleAudioSpeed();
          }}
          title={audioSpeedDisabledReason ?? undefined}
          aria-disabled={audioSpeedDisabledReason !== null || undefined}
          data-testid="audio-tool-speed"
        >
          <Gauge size={14} strokeWidth={2} />
          <span>调速</span>
        </button>
      )}
      {/* 场景切分（IKH8BJ）：仅视频卡显示，落「音视频分离」之后、分隔线之前；同音视频分离
          形态（图标+文字单按钮、native disabled 置灰 + title 悬停原因/可用态 hint） */}
      {data.mediaType === 'video' && (
        <button
          className={styles.toolBtn}
          onClick={handleSceneSplit}
          disabled={sceneSplitDisabledReason !== null}
          title={sceneSplitDisabledReason ?? SCENE_SPLIT_ENTRY_HINT}
        >
          <Film size={14} strokeWidth={2} />
          <span>场景切分</span>
        </button>
      )}
      {/* 智能抠像（IKHK7N，ADR-0112）：仅视频卡显示，落「场景切分」之后、分隔线之前；
          模式前置到入口下拉（SmartMattingMenu，形态同「智能去字幕 ▾」家族），触发钮
          点击直启首项「人像抠像」；门槛置灰走 aria-disabled（hover 仍展开看原因） */}
      {data.mediaType === 'video' && (
        <SmartMattingMenu
          items={smartMattingMenuItems}
          triggerHint={SMART_MATTING_ENTRY_HINT}
        />
      )}
      {toolbar.audioTools && (
        <button type="button" className={styles.toolBtn}
          title={audioMixDisabledReason ?? undefined}
          aria-disabled={audioMixDisabledReason !== null || undefined}
          data-testid="audio-tool-mix"
          onClick={() => { if (audioMixDisabledReason === null) data.onMixAudio?.(id); }}>
          <Layers size={14} strokeWidth={2} />
          <span>混合</span>
        </button>
      )}
      {/* 音频卡剩余两功能占位（IKH8Q3）：aria-disabled 置灰保持渲染（口径同画质横排
          .toolBtn[aria-disabled='true']），title 悬停「即将上线」，不绑定任何点击行为 */}
      {toolbar.audioTools && audioToolItems.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            className={styles.toolBtn}
            title={AUDIO_TOOL_PLACEHOLDER_HINT}
            aria-disabled="true"
            data-testid={`audio-tool-${item.id}`}
          >
            <Icon size={14} strokeWidth={2} />
            <span>{item.label}</span>
          </button>
        );
      })}
      <span className={styles.toolDivider} />
      {!toolbar.audioTools && (
        <button className={styles.toolBtn} onClick={handleShowDetails} title="详情">
          <Info size={14} strokeWidth={2} />
        </button>
      )}
      <button className={styles.toolBtn} onClick={handleDownload} title="下载">
        <Download size={14} strokeWidth={2} />
      </button>
      {toolbar.mention && (
        <button className={styles.toolBtn} onClick={handleMention} title="添加到 Agent 聊天">
          <AtSign size={14} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
