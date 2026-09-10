/* ============================================
 * AudioPlayer：画布音频节点的自包含播放器
 * 白色卡片 + 浅灰波形区 + 播放控制，样式参考设计稿
 * ============================================ */
import { useRef, useState, useEffect, useCallback } from 'react';
import { Play, Pause } from 'lucide-react';
import styles from './index.module.css';

interface AudioPlayerProps {
  src: string;
  fileName?: string;
  onDownload?: () => void;
}

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const BARS = 24;

/** 生成静态波形条高度（伪随机但稳定，避免每次渲染跳动） */
const barHeights = Array.from({ length: BARS }, (_, i) => {
  const t = i / BARS;
  const base = 0.25 + 0.5 * Math.sin(t * Math.PI * 3);
  return 20 + Math.round(base * 60);
});

export default function AudioPlayer({ src, fileName, onDownload }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [err, setErr] = useState(false);
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const onLoaded = useCallback(() => {
    if (audioRef.current) setDuration(audioRef.current.duration || 0);
  }, []);

  /** timeupdate 兜底：拖拽时不更新，播放中主要靠 rAF 高频刷新 */
  const onTimeUpdate = useCallback(() => {
    if (audioRef.current && !dragging) setCurrentTime(audioRef.current.currentTime);
  }, [dragging]);

  /** 播放中使用 requestAnimationFrame 高频刷新进度，避免 timeupdate 事件间隔大导致卡顿 */
  const rafRef = useRef<number | null>(null);
  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);
  const tick = useCallback(() => {
    const a = audioRef.current;
    if (a && !dragging) {
      setCurrentTime(a.currentTime);
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [dragging]);

  useEffect(() => {
    if (playing) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      stopRaf();
    }
    return stopRaf;
  }, [playing, tick, stopRaf]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      void a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      a.pause();
      setPlaying(false);
    }
  }, []);

  const ratioFromClientX = useCallback((clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const r = (clientX - rect.left) / rect.width;
    return Math.min(1, Math.max(0, r));
  }, []);

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setErr(false);
  }, [src]);

  // 组件卸载时兜底移除拖拽监听，防止泄漏
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', () => {});
      document.removeEventListener('mouseup', () => {});
    };
  }, []);

  const handleTrackDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const a = audioRef.current;
    if (!a || !duration) return;
    setDragging(true);

    const seekTo = (clientX: number) => {
      const r = ratioFromClientX(clientX);
      const t = r * duration;
      a.currentTime = t;
      setCurrentTime(t);
    };

    seekTo(e.clientX);

    const handleMove = (ev: MouseEvent) => seekTo(ev.clientX);
    const handleUp = () => {
      setDragging(false);
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [duration, ratioFromClientX]);

  const progressPct = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className={styles.audioPlayer} onClick={(e) => e.stopPropagation()}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={onLoaded}
        onTimeUpdate={onTimeUpdate}
        onEnded={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => setErr(true)}
      />

      {/* 浅灰波形区：可点击拖拽 seek；紫色 playhead 指示当前进度 */}
      <div
        className={`${styles.audioWaveBox} nodrag nopan`}
        ref={trackRef}
        onMouseDown={handleTrackDown}
      >
        <div className={styles.audioWaveBars}>
          {barHeights.map((h, i) => (
            <span
              key={i}
              className={styles.audioWaveBar}
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
        <div
          className={styles.audioPlayhead}
          style={{ left: `${progressPct}%` }}
        />
      </div>

      {/* 底部控制区：时间 + 播放按钮 */}
      <div className={styles.audioControls}>
        <div className={styles.audioTime}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
        <button
          className={`${styles.audioPlayBtn} nodrag nopan`}
          onClick={toggle}
          aria-label={playing ? '暂停' : '播放'}
        >
          {playing
            ? <Pause size={18} strokeWidth={2.5} color="#fff" />
            : <Play size={18} strokeWidth={2.5} color="#fff" style={{ marginLeft: 2 }} />}
        </button>
      </div>

      {err && (
        <div className={styles.audioErr}>加载失败</div>
      )}
    </div>
  );
}
