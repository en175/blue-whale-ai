import { Pause, Play } from 'lucide-react';
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/utils/remoteImageCors';
import styles from './index.module.css';

export type AudioPlayerVariant = 'compact' | 'full';

export interface AudioPlayerHandle {
  startPreview: () => void;
  stopPreview: () => void;
}

interface AudioPlayerProps {
  src: string;
  /** compact 用于瀑布流卡片，full 用于详情弹窗（可交互） */
  variant?: AudioPlayerVariant;
  /** 元数据（时长等）就绪时回调 */
  onLoadedMetadata?: () => void;
  onError?: () => void;
  className?: string;
}

/** 秒数格式化为 m:ss，无限/NaN 显示 0:00 */
function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

/**
 * Library 轻量音频播放器：替换浏览器原生 <audio controls>。
 * full 形态保留播放/暂停控制，并由与卡片相同的 Audio Wave 反馈播放状态；
 * 素材卡片通过 ref 从整张卡片边界触发悬浮试听，避免只命中播放器本体。
 */
const AudioPlayer = memo(forwardRef<AudioPlayerHandle, AudioPlayerProps>(function AudioPlayer({
  src,
  variant = 'full',
  onLoadedMetadata,
  onError,
  className,
}, ref) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const seekingRef = useRef(false);
  const hoverPreviewingRef = useRef(false);
  const reportedMetadataSourceRef = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const syncMetadata = useCallback((fromMetadataEvent = false) => {
    const audio = audioRef.current;
    if (!audio) return;

    // 虚拟列表复用卡片或命中浏览器缓存时，loadedmetadata 可能早于 React
    // 事件处理器派发。直接读取已经就绪的原生状态，避免骨架屏永久遮住播放器。
    if (!fromMetadataEvent && audio.readyState < HTMLMediaElement.HAVE_METADATA) return;

    if (Number.isFinite(audio.duration)) {
      setDuration(audio.duration);
    }

    if (reportedMetadataSourceRef.current !== src) {
      reportedMetadataSourceRef.current = src;
      onLoadedMetadata?.();
    }
  }, [onLoadedMetadata, src]);

  useLayoutEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    reportedMetadataSourceRef.current = null;
  }, [src]);

  useLayoutEffect(() => {
    syncMetadata();
  }, [syncMetadata]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  }, []);

  const stopPreview = useCallback(() => {
    hoverPreviewingRef.current = false;
    const audio = audioRef.current;
    if (!audio) return;

    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {
      // 元数据尚未就绪时不能定位，暂停即可。
    }
    setPlaying(false);
    setCurrentTime(0);
  }, []);

  const startPreview = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    hoverPreviewingRef.current = true;
    void audio.play()
      .then(() => {
        // 快速移出时，浏览器可能在 pause 后才完成 play Promise；此处兜底关停。
        if (!hoverPreviewingRef.current) stopPreview();
      })
      .catch(() => setPlaying(false));
  }, [stopPreview]);

  useImperativeHandle(ref, () => ({ startPreview, stopPreview }), [startPreview, stopPreview]);
  useEffect(() => () => stopPreview(), [stopPreview]);

  const seekToRatio = useCallback((ratio: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const clamped = Math.min(1, Math.max(0, ratio));
    audio.currentTime = clamped * audio.duration;
    setCurrentTime(audio.currentTime);
  }, []);

  const handleProgressKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;

    const step = event.shiftKey ? 10 : 5;
    let nextTime: number | undefined;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      nextTime = audio.currentTime - step;
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      nextTime = audio.currentTime + step;
    } else if (event.key === 'Home') {
      nextTime = 0;
    } else if (event.key === 'End') {
      nextTime = audio.duration;
    }

    if (nextTime === undefined) return;
    event.preventDefault();
    audio.currentTime = Math.min(audio.duration, Math.max(0, nextTime));
    setCurrentTime(audio.currentTime);
  }, []);

  /** 进度条按下：即时跳转并跟随拖动（Pointer Capture） */
  const handleSeekPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    seekingRef.current = true;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* 不支持 Pointer Capture 时退化为点击跳转 */
    }
    const rect = event.currentTarget.getBoundingClientRect();
    seekToRatio((event.clientX - rect.left) / rect.width);
  }, [seekToRatio]);

  const handleSeekPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!seekingRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    seekToRatio((event.clientX - rect.left) / rect.width);
  }, [seekToRatio]);

  const handleSeekPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!seekingRef.current) return;
    seekingRef.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const progressRatio = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const isCompact = variant === 'compact';

  return (
    <div
      className={`${styles.player} ${isCompact ? styles.compact : styles.full} ${className ?? ''}`}
      {...(isCompact ? { 'aria-hidden': true } : {})}
    >
      <audio
        ref={audioRef}
        src={resolveMediaSrc(src)}
        crossOrigin={remoteImageCrossOrigin(src)}
        preload="metadata"
        onLoadedMetadata={() => syncMetadata(true)}
        onDurationChange={() => syncMetadata()}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => onError?.()}
      />
      {isCompact ? (
        <div
          className={`${styles.audioWave} ${playing ? styles.audioWavePlaying : ''}`}
          data-testid="audio-wave"
        >
          {Array.from({ length: 9 }, (_, index) => (
            <span key={index} className={styles.waveBar} data-testid="audio-wave-bar" />
          ))}
        </div>
      ) : (
        <div
          className={`${styles.audioWave} ${styles.fullWave} ${playing ? styles.audioWavePlaying : ''}`}
          data-testid="audio-wave"
        >
          {Array.from({ length: 9 }, (_, index) => (
            <span key={index} className={styles.waveBar} data-testid="audio-wave-bar" />
          ))}
        </div>
      )}
      <div
        className={isCompact ? styles.compactControls : styles.fullControls}
        data-testid={isCompact ? 'audio-compact-controls' : 'audio-controls'}
      >
        {!isCompact && (
          <button
            type="button"
            className={styles.playBtn}
            onClick={togglePlay}
            aria-label={playing ? '暂停' : '播放'}
          >
            {playing ? <Pause size={18} /> : <Play size={18} className={styles.playGlyph} />}
          </button>
        )}
        <div
          className={styles.progress}
          role="slider"
          aria-label="播放进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progressRatio * 100)}
          aria-valuetext={`${formatSeconds(currentTime)} / ${formatSeconds(duration)}`}
          tabIndex={isCompact ? -1 : 0}
          onPointerDown={handleSeekPointerDown}
          onPointerMove={handleSeekPointerMove}
          onPointerUp={handleSeekPointerUp}
          onPointerCancel={handleSeekPointerUp}
          onKeyDown={handleProgressKeyDown}
          onClick={(event) => event.stopPropagation()}
        >
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${progressRatio * 100}%` }} />
          </div>
        </div>
        <div className={styles.time}>
          <span className={styles.timeCurrent}>{formatSeconds(currentTime)}</span>
          <span className={styles.timeDivider}>/</span>
          <span>{formatSeconds(duration)}</span>
        </div>
      </div>
    </div>
  );
}));

export default AudioPlayer;
