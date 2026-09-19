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
 * ============================================ */
import { useCallback } from 'react';
import { AudioLines, Info, Download, AtSign, ZoomIn, Eraser, Crop, Maximize2, WandSparkles, type LucideIcon } from 'lucide-react';
import { outpaintGateReason } from '../../imageOutpaint';
import { imageEraseGateReason } from '../../imageErase';
import { imageCutoutGateReason } from '../../imageCutout';
import { videoSubtitleEraseGateReason } from '../../videoSubtitleErase';
import { AUDIO_VIDEO_SPLIT_ENTRY_HINT, audioVideoSplitGateReason } from '../../audioVideoSplit';
import { VIDEO_ENHANCE_ENTRY_HINT, videoEnhanceGateReason } from '../../videoEnhance';
import { mediaNodeToolbarVisibility, mediaCardToolbarVisible } from './toolbarVisibility';
import SubtitleEraseMenu, { type SubtitleEraseMenuItem } from './SubtitleEraseMenu';
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
  /** 音视频分离（IKH28U）：点击进入编辑态（不再一键直发，发送闭环归 IKH28X），
   *  对齐「智能去字幕」一行派发模式；置灰预检见 audioVideoSplit.ts（assetId 缺失唯一置灰） */
  const handleAudioVideoSplit = useCallback(() => data.onAudioVideoSplit?.(id), [data, id]);
  const audioVideoSplitDisabledReason = audioVideoSplitGateReason(data);
  /** 视频 HD 高清（IKH3VG）：点击在源卡右侧建 HD 草稿卡并弹出 HD 面板；置灰预检见
   *  videoEnhance.ts（未关联资产 / 短长边超上限 / 短边不足 360，宽高缺失放行） */
  const handleVideoEnhance = useCallback(() => data.onVideoEnhance?.(id), [data, id]);
  const videoEnhanceDisabledReason = videoEnhanceGateReason(data);
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

  /* 数据门（同迁移前 MediaNode 内判定）：生成流程卡 / 素材缺失 / 空壳上传卡不显；
   *  谓词与 CanvasPage 显隐门共用（mediaCardToolbarVisible，IKGYYB 审查消双实现） */
  if (!mediaCardToolbarVisible(data)) return null;

  return (
    <div className={styles.toolbar}>
      {toolbar.videoEnhance && (
        <button
          className={styles.toolBtn}
          onClick={handleVideoEnhance}
          disabled={videoEnhanceDisabledReason !== null}
          title={videoEnhanceDisabledReason ?? VIDEO_ENHANCE_ENTRY_HINT}
          data-testid="video-enhance-btn"
        >
          <span className={styles.hdBadge}>HD</span>
          <span>高清</span>
        </button>
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
        <button
          className={styles.toolBtn}
          onClick={handleAudioVideoSplit}
          disabled={audioVideoSplitDisabledReason !== null}
          title={audioVideoSplitDisabledReason ?? AUDIO_VIDEO_SPLIT_ENTRY_HINT}
        >
          <AudioLines size={14} strokeWidth={2} />
          <span>音视频分离</span>
        </button>
      )}
      <span className={styles.toolDivider} />
      <button className={styles.toolBtn} onClick={handleShowDetails} title="详情">
        <Info size={14} strokeWidth={2} />
      </button>
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
