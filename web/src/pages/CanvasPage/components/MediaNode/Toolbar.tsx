import { useCallback } from 'react';
import { Info, Download, AtSign, ZoomIn, Eraser, Crop, Maximize2, WandSparkles, Scissors, Gauge, Layers, Clapperboard, Film, type LucideIcon } from 'lucide-react';
import { outpaintGateReason } from '../../imageOutpaint';
import { imageEraseGateReason } from '../../imageErase';
import { imageCutoutGateReason } from '../../imageCutout';
import { videoSubtitleEraseGateReason } from '../../videoSubtitleErase';
import { AUDIO_VIDEO_SPLIT_ENTRY_HINT, audioVideoSplitGateReason } from '../../audioVideoSplit';
import { audioTrimGateReason } from '../../audioTrim';
import { audioMixSourceError } from '../../audioMix';
import { audioSpeedGateReason } from '../../audioSpeed';
import { audioVideoMuxSourceError } from '../../audioVideoMux';
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

interface QualityToolItem {
  id: string;
  label: string;
  icon: LucideIcon;
  hint?: string;
  disabledReason: string | null;
  onSelect: () => void;
}

interface MediaNodeToolbarProps {
  id: string;
  data: MediaNodeData;
}

const AUDIO_TOOL_PLACEHOLDER_HINT = '即将上线';
const audioToolItems: Array<{ id: string; label: string; icon: LucideIcon }> = [
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
  const outpaintDisabledReason = outpaintGateReason(
    typeof data.width === 'number' ? data.width : undefined,
    typeof data.height === 'number' ? data.height : undefined,
    typeof data.size === 'number' ? data.size : undefined,
  );
  const videoSubtitleEraseDisabledReason = videoSubtitleEraseGateReason(data);
  const handleCropImage = useCallback(() => data.onCropImage?.(id), [data, id]);
  const handleCutoutImage = useCallback(() => data.onCutoutImage?.(id), [data, id]);
  const handleAudioVideoSplit = useCallback(() => data.onAudioVideoSplit?.(id), [data, id]);
  const audioVideoSplitDisabledReason = audioVideoSplitGateReason(data);
  const handleTrimAudio = useCallback(() => data.onTrimAudio?.(id), [data, id]);
  const audioTrimDisabledReason = audioTrimGateReason(data);
  const audioMixDisabledReason = audioMixSourceError({ id, type: 'mediaNode', position: { x: 0, y: 0 }, data: data as unknown as Record<string, unknown> });
  const handleAudioSpeed = useCallback(() => data.onAudioSpeed?.(id), [data, id]);
  const audioSpeedDisabledReason = audioSpeedGateReason(data);
  const handleComposeAudioVideo = useCallback(() => data.onComposeAudioVideo?.(id), [data, id]);
  const audioVideoMuxDisabledReason = audioVideoMuxSourceError(data as unknown as Record<string, unknown>);
  const audioVideoMuxInFlight = (data as unknown as Record<string, unknown>).audioVideoMuxInFlight === true;
  const handleVocalBackgroundSplit = useCallback(() => data.onVocalBackgroundSplit?.(id), [data, id]);
  const handleSceneSplit = useCallback(() => data.onSceneSplit?.(id), [data, id]);
  const sceneSplitDisabledReason = sceneSplitGateReason(data);
  const handleSmartMattingPortrait = useCallback(
    () => data.onSmartMatting?.(id, 'portrait'),
    [data, id],
  );
  const handleSmartMattingGreenscreen = useCallback(
    () => data.onSmartMatting?.(id, 'greenscreen'),
    [data, id],
  );
  const smartMattingDisabledReason = smartMattingGateReason(data);
  const handleVideoEnhance = useCallback(() => data.onVideoEnhance?.(id), [data, id]);
  const videoEnhanceDisabledReason = videoEnhanceGateReason(data);
  const handleFrameInterpolation = useCallback(() => data.onFrameInterpolation?.(id), [data, id]);
  const frameInterpolationDisabledReason = frameInterpolationGateReason(data);
  const handleDownload = useCallback(() => data.onDownload?.(id), [data, id]);
  const handleShowDetails = useCallback(() => data.onShowDetails?.(id), [data, id]);
  const handleMention = useCallback(() => data.onAddToChat?.(id), [data, id]);

  const toolbar = mediaNodeToolbarVisibility(data.mediaType);
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
      {}
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
      {}
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
      {}
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
      {}
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
      {}
      {toolbar.audioTools && (
        <button type="button"
          className={`${styles.toolBtn} ${audioVideoMuxInFlight ? styles.toolBtnActive : ''}`}
          title={audioVideoMuxDisabledReason ?? undefined}
          aria-disabled={audioVideoMuxDisabledReason !== null || undefined}
          aria-pressed={audioVideoMuxInFlight || undefined}
          data-testid="audio-tool-compose"
          onClick={() => { if (audioVideoMuxDisabledReason === null) handleComposeAudioVideo(); }}>
          <Clapperboard size={14} strokeWidth={2} />
          <span>音视频合成</span>
        </button>
      )}
      {}
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
