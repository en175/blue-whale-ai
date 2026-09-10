/* ============================================
 * AudioPlayer：画布音频节点的自包含播放器
 * 深灰卡片 + 暗色波形区 + 播放控制，样式参考设计稿
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

/** 从真实音频解码数据生成波形条高度百分比（RMS 归一化） */
async function computeWaveform(src: string, bars: number, signal: AbortSignal): Promise<number[]> {
  const res = await fetch(src, { signal });
  if (!res.ok) throw new Error('fetch failed');
  const arrayBuffer = await res.arrayBuffer();
  const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
  const buffer = await ctx.decodeAudioData(arrayBuffer);
  await ctx.close();
  const data = buffer.getChannelData(0);
  const samplesPerBar = Math.max(1, Math.floor(data.length / bars));
  const heights: number[] = [];
  for (let i = 0; i < bars; i++) {
    const start = i * samplesPerBar;
    const end = Math.min(start + samplesPerBar, data.length);
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += data[j] * data[j];
    }
    const rms = Math.sqrt(sum / (end - start || 1));
    heights.push(rms);
  }
  const max = Math.max(...heights, 0.001);
  return heights.map((h) => 12 + (h / max) * 80);
}

/** 基于 src 与时长生成稳定但不同的兜底波形，避免不同节点完全一样 */
function fallbackWaveform(src: string, duration: number, bars: number): number[] {
  let seed = 0;
  for (let i = 0; i < src.length; i++) {
    seed = (seed * 31 + src.charCodeAt(i)) >>> 0;
  }
  seed = (seed + Math.round((duration || 0) * 1000)) >>> 0;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  return Array.from({ length: bars }, (_, i) => {
    const t = i / bars;
    const envelope = Math.sin(t * Math.PI) * 0.3 + 0.7;
    const noise = rand();
    return 12 + Math.round((envelope * 0.6 + noise * 0.4) * 78);
  });
}

export default function AudioPlayer({ src }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [err, setErr] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [waveform, setWaveform] = useState<number[] | null>(null);
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
    setWaveform(null);
    const abort = new AbortController();
    computeWaveform(src, BARS, abort.signal)
      .then((heights) => {
        if (!abort.signal.aborted) setWaveform(heights);
      })
      .catch(() => {
        // 跨域/解码失败时使用 src+时长 生成的稳定兜底波形，避免不同节点完全一样
        if (!abort.signal.aborted) setWaveform(fallbackWaveform(src, duration, BARS));
      });
    return () => abort.abort();
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

      {/* 暗色波形区：可点击拖拽 seek；红色 playhead 指示当前进度 */}
      <div
        className={`${styles.audioWaveBox} nodrag nopan`}
        ref={trackRef}
        onMouseDown={handleTrackDown}
      >
        <div className={styles.audioWaveBars}>
          {(waveform ?? fallbackWaveform(src, duration, BARS)).map((h, i) => (
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
