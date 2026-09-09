/* ============================================
 * AudioPlayer：画布音频节点的自包含播放器
 * 唱片封面 + 播放按钮 + 频谱律动 + 进度条拖拽
 * ============================================ */
import { useRef, useState, useEffect, useCallback } from 'react';
import { Play, Pause, AudioLines } from 'lucide-react';
import styles from './index.module.css';

interface AudioPlayerProps {
  src: string;
  fileName?: string;
}

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const BARS = 18;

export default function AudioPlayer({ src, fileName }: AudioPlayerProps) {
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

  const onTimeUpdate = useCallback(() => {
    if (audioRef.current && !dragging) setCurrentTime(audioRef.current.currentTime);
  }, [dragging]);

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

      {/* 唱片封面 */}
      <div className={`${styles.audioCoverWrap} nodrag nopan`}>
        <div className={`${styles.audioDisc} ${playing ? styles.audioDiscSpinning : ''}`}>
          <div className={styles.audioDiscCenter}>
            <AudioLines size={28} strokeWidth={1.8} color="#bbb" />
          </div>
        </div>

        <button
          className={`${styles.audioPlayBtn} nodrag nopan`}
          onClick={toggle}
          aria-label={playing ? '暂停' : '播放'}
        >
          {playing
            ? <Pause size={18} strokeWidth={2.5} />
            : <Play size={18} strokeWidth={2.5} style={{ marginLeft: 2 }} />}
        </button>
      </div>

      {/* 频谱律动条 */}
      <div className={styles.audioSpectrum}>
        {Array.from({ length: BARS }).map((_, i) => (
          <span
            key={i}
            className={`${styles.audioBar} ${playing ? styles.audioBarAnim : ''}`}
            style={{ animationDelay: `${(i * 0.07) % 0.42}s` }}
          />
        ))}
      </div>

      {/* 文件名 */}
      <div className={styles.audioName} title={fileName || ''}>
        {fileName || '未命名音频'}
      </div>

      {/* 进度条：需要 nodrag nopan 否则拖拽进度条会带动节点 */}
      <div className={`${styles.audioProgress} nodrag nopan`} ref={trackRef} onMouseDown={handleTrackDown}>
        <div className={styles.audioProgressTrack} />
        <div
          className={styles.audioProgressFill}
          style={{ width: `${progressPct}%` }}
        />
        <div
          className={styles.audioProgressThumb}
          style={{ left: `calc(${progressPct}% - 5px)` }}
        />
      </div>

      {/* 时长 */}
      <div className={styles.audioTime}>
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>

      {err && (
        <div className={styles.audioErr}>加载失败</div>
      )}
    </div>
  );
}
