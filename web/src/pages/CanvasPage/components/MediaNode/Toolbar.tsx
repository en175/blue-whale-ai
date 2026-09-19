/* ============================================
 * MediaNodeToolbar 媒体卡悬浮工具条（IKGYYD 自 MediaNode/index.tsx 迁出）：
 * 按钮构成/顺序/文案/置灰门槛与迁移前完全一致；DOM 迁出节点卡后由通用钉屏幕容器
 * NodeFollowToolbar 承载（画布缩放层之外、任何缩放级别屏幕尺寸恒定、拖动/平移缩放实时跟随）。
 * 显隐分工：「唯一选中 + 画布无多选」在 NodeFollowToolbar 容器（useSoloNodeSelected 口径不变）；
 * 本组件承担数据条件（生成流程卡 / 素材缺失 / 空壳上传卡不显；
 * 「重新编辑」仅有生成记录的成品卡展示，IKGX5M）。
 * 工具条 DOM 不再位于节点卡内：点击按钮天然不触发节点拖拽/选中变化（原 nodrag/nopan 与
 * stopPropagation 防护随迁移移除），点击也不落在 React Flow pane 上（不触发 PaneClick）。
 * ============================================ */
import { useCallback } from 'react';
import { Video, RefreshCcw, Sparkles, AudioLines, Info, Download, AtSign, Expand, Eraser, Crop, Maximize2, WandSparkles, Subtitles } from 'lucide-react';
import { outpaintGateReason } from '../../imageOutpaint';
import { imageEraseGateReason } from '../../imageErase';
import { imageCutoutGateReason } from '../../imageCutout';
import { VIDEO_SUBTITLE_ERASE_ENTRY_HINT, videoSubtitleEraseGateReason } from '../../videoSubtitleErase';
import { AUDIO_VIDEO_SPLIT_ENTRY_HINT, audioVideoSplitGateReason } from '../../audioVideoSplit';
import { hasGenerationRecordData } from '../../mediaReEdit';
import { mediaNodeToolbarVisibility, mediaCardToolbarVisible } from './toolbarVisibility';
import ImageQualityMenu, { type ImageQualityMenuItem } from './ImageQualityMenu';
import type { MediaNodeData } from './index';
import styles from './index.module.css';

function reEditTooltip(mediaType: MediaNodeData['mediaType']): string {
  if (mediaType === 'video') return '带入原提示词与参考，打开视频对话框';
  if (mediaType === 'audio') return '带入原提示词与参考，打开音频对话框';
  return '带入原提示词与图片，打开图片对话框';
}

interface MediaNodeToolbarProps {
  id: string;
  data: MediaNodeData;
}

export default function MediaNodeToolbar({ id, data }: MediaNodeToolbarProps) {
  const handleReEdit = useCallback(() => data.onReEdit?.(id), [data, id]);
  const handleGenImage = useCallback(() => data.onGenImage?.(id), [data, id]);
  const handleGenVideo = useCallback(() => data.onGenVideo?.(id), [data, id]);
  const handleVideoSubtitleErase = useCallback(() => data.onVideoSubtitleErase?.(id), [data, id]);
  const handleEnhanceImage = useCallback(() => data.onEnhanceImage?.(id), [data, id]);
  const handleEraseImage = useCallback(() => data.onEraseImage?.(id), [data, id]);
  const handleOutpaintImage = useCallback(() => data.onOutpaintImage?.(id), [data, id]);
  /** 扩图可用性预检（打开菜单时按当前源图快照判定）：置灰并悬停说明原因 */
  const outpaintDisabledReason = outpaintGateReason(
    typeof data.width === 'number' ? data.width : undefined,
    typeof data.height === 'number' ? data.height : undefined,
    typeof data.size === 'number' ? data.size : undefined,
  );
  /** 「智能去字幕」可用性预检（IKGZ82）：分辨率超 2K 或时长超 10 分钟置灰并悬停原因；
   *  宽高/时长缺失不拦（null 放行，后端按权威数据复核）。可用态悬停为效果边界一句，
   *  与置灰原因走同一 title 通道（互斥）。 */
  const videoSubtitleEraseDisabledReason = videoSubtitleEraseGateReason(data);
  const handleCropImage = useCallback(() => data.onCropImage?.(id), [data, id]);
  const handleCutoutImage = useCallback(() => data.onCutoutImage?.(id), [data, id]);
  /** 音视频分离（IKH28U）：点击进入编辑态（不再一键直发，发送闭环归 IKH28X），
   *  对齐「智能去字幕」一行派发模式；置灰预检见 audioVideoSplit.ts（assetId 缺失唯一置灰） */
  const handleAudioVideoSplit = useCallback(() => data.onAudioVideoSplit?.(id), [data, id]);
  const audioVideoSplitDisabledReason = audioVideoSplitGateReason(data);
  const handleDownload = useCallback(() => data.onDownload?.(id), [data, id]);
  const handleShowDetails = useCallback(() => data.onShowDetails?.(id), [data, id]);
  const handleMention = useCallback(() => data.onAddToChat?.(id), [data, id]);

  const toolbar = mediaNodeToolbarVisibility(data.mediaType);
  const showReEdit = hasGenerationRecordData(data);
  /** 「高清 ▾」下拉菜单项（IKGOT7，数组配置驱动）：顺序高清、扩图、裁切、擦除、抠图；
   *  擦除按 imageErase 门槛预检置灰（title 悬停原因，尺寸 null 不拦）、扩图按
   *  outpaintGateReason 门槛预检置灰、裁切无置灰门槛恒可用；
   *  抠图（IKGXLT/IKGXMT）在「擦除」之后追加，按 imageCutout 门槛预检置灰（无最小边判定，
   *  通用场景上限 10240/6000/40MP + 30MB；点击经 onCutoutImage 进入抠图工具栏） */
  const qualityMenuItems: ImageQualityMenuItem[] = [
    {
      id: 'enhance',
      label: '高清',
      icon: Expand,
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

  /* 数据门（同迁移前 MediaNode 内判定）：生成流程卡 / 素材缺失 / 空壳上传卡不显；
   *  谓词与 CanvasPage 显隐门共用（mediaCardToolbarVisible，IKGYYB 审查消双实现） */
  if (!mediaCardToolbarVisible(data)) return null;

  return (
    <div className={styles.toolbar}>
      {showReEdit && (
        <button className={styles.toolBtn} onClick={handleReEdit} title={reEditTooltip(data.mediaType)}>
          <RefreshCcw size={14} strokeWidth={2} />
          <span>重新编辑</span>
        </button>
      )}
      {toolbar.genImage && (
        <button className={styles.toolBtn} onClick={handleGenImage} title="新建图片草稿并以本图为参考">
          <Sparkles size={14} strokeWidth={2} />
          <span>生成图片</span>
        </button>
      )}
      {toolbar.genVideo && (
        <button className={styles.toolBtn} onClick={handleGenVideo} title="带入图片，打开视频对话框">
          <Video size={14} strokeWidth={2} />
          <span>生成视频</span>
        </button>
      )}
      {toolbar.videoSubtitleErase && (
        <button
          className={styles.toolBtn}
          onClick={handleVideoSubtitleErase}
          disabled={videoSubtitleEraseDisabledReason !== null}
          title={videoSubtitleEraseDisabledReason ?? VIDEO_SUBTITLE_ERASE_ENTRY_HINT}
        >
          <Subtitles size={14} strokeWidth={2} />
          <span>智能去字幕</span>
        </button>
      )}
      {toolbar.imageQuality && (
        <ImageQualityMenu items={qualityMenuItems} />
      )}
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
