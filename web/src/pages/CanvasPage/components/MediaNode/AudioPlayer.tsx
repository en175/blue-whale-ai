import { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Play, Pause } from 'lucide-react';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/utils/remoteImageCors';
import { formatTime } from './mediaPlayback';
import styles from './index.module.css';
export interface AudioPlayerTrimSelection {
  start: number;
  end: number;
}

export interface AudioPlayerHandle {
  seekTo(time: number): void;
  pause(): boolean;
  playFrom(time: number): void;
}

interface AudioPlayerProps {
  src: string;
  fileName?: string;
  duration?: number;
  onDownload?: () => void;
  speedEditing?: boolean;
  speedFactor?: number;
  trimSelection?: AudioPlayerTrimSelection | null;
  trimOverlay?: React.ReactNode;
}

const BARS = 72;

async function computeWaveform(src: string, bars: number, signal: AbortSignal): Promise<number[]> {
  const fetchUrl = resolveMediaSrc(src);
  const res = await fetch(fetchUrl, { signal });
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

const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(function AudioPlayer(
  { src, duration: authoritativeDuration, speedEditing, speedFactor, trimSelection, trimOverlay },
  ref,
) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(authoritativeDuration ?? 0);
  const [currentTime, setCurrentTime] = useState(0);
  const [err, setErr] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [waveform, setWaveform] = useState<number[] | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const onLoaded = useCallback(() => {
    if (audioRef.current && authoritativeDuration == null) setDuration(audioRef.current.duration || 0);
  }, [authoritativeDuration]);

  const onTimeUpdate = useCallback(() => {
    if (audioRef.current && !dragging) setCurrentTime(audioRef.current.currentTime);
  }, [dragging]);

  const rafRef = useRef<number | null>(null);
  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);
  const tick = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      if (trimSelection && a.currentTime >= trimSelection.end - 1e-6 && !a.paused) {
        a.currentTime = trimSelection.end;
        a.pause();
        setCurrentTime(trimSelection.end);
      } else if (!dragging) {
        setCurrentTime(a.currentTime);
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [dragging, trimSelection]);

  useEffect(() => {
    if (playing) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      stopRaf();
    }
    return stopRaf;
  }, [playing, tick, stopRaf]);

  const prevSpeedEditingRef = useRef(false);
  useEffect(() => {
    const a = audioRef.current;
    const prev = prevSpeedEditingRef.current;
    prevSpeedEditingRef.current = speedEditing === true;
    if (!a || !speedEditing || prev) return;
    if (!a.paused) a.pause();
    a.currentTime = 0;
    setCurrentTime(0);
  }, [speedEditing]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const rate = typeof speedFactor === 'number' && speedFactor > 0 ? speedFactor : 1;
    a.playbackRate = rate;
    const pitched = a as HTMLAudioElement & { webkitPreservesPitch?: boolean };
    if ('preservesPitch' in a) a.preservesPitch = true;
    pitched.webkitPreservesPitch = true;
  }, [speedFactor]);

  const effectiveSpeed = typeof speedFactor === 'number' && speedFactor > 0 ? speedFactor : 1;

  const prevSelectionRef = useRef<AudioPlayerTrimSelection | null>(null);
  useEffect(() => {
    const a = audioRef.current;
    const prev = prevSelectionRef.current;
    prevSelectionRef.current = trimSelection ?? null;
    if (!a || !trimSelection) return;
    if (prev && prev.start === trimSelection.start && prev.end === trimSelection.end) return;
    if (!a.paused) a.pause();
    if (prev == null) {
      a.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    const t = a.currentTime;
    if (t < trimSelection.start || t > trimSelection.end) {
      const clamped = Math.min(Math.max(t, trimSelection.start), trimSelection.end);
      a.currentTime = clamped;
      setCurrentTime(clamped);
    }
  }, [trimSelection]);

  useImperativeHandle(ref, () => ({
    seekTo: (time: number) => {
      const a = audioRef.current;
      if (!a) return;
      a.currentTime = time;
      setCurrentTime(time);
    },
    pause: () => {
      const a = audioRef.current;
      if (!a) return false;
      const wasPlaying = !a.paused;
      if (wasPlaying) {
        a.pause();
        setPlaying(false);
      }
      return wasPlaying;
    },
    playFrom: (time: number) => {
      const a = audioRef.current;
      if (!a) return;
      a.currentTime = time;
      setCurrentTime(time);
      void a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    },
  }), []);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      if (trimSelection && (a.currentTime < trimSelection.start || a.currentTime >= trimSelection.end - 1e-6)) {
        a.currentTime = trimSelection.start;
        setCurrentTime(trimSelection.start);
      }
      void a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      a.pause();
      setPlaying(false);
    }
  }, [trimSelection]);

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
        if (!abort.signal.aborted) setWaveform(fallbackWaveform(src, duration, BARS));
      });
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

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
      let t = r * duration;
      if (trimSelection) {
        t = Math.min(Math.max(t, trimSelection.start), trimSelection.end);
      }
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
  }, [duration, ratioFromClientX, trimSelection]);

  const progressPct = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className={styles.audioPlayer}>
      <audio
        ref={audioRef}
        src={resolveMediaSrc(src)}
        crossOrigin={remoteImageCrossOrigin(src)}
        preload="metadata"
        onLoadedMetadata={onLoaded}
        onTimeUpdate={onTimeUpdate}
        onEnded={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => setErr(true)}
      />

      {}
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
        {}
        {trimOverlay}
      </div>

      {}
      <div className={styles.audioControls}>
        <div className={styles.audioTime}>
          {speedEditing
            ? `${formatTime(Math.round(currentTime / effectiveSpeed))} / ${formatTime(Math.round(duration / effectiveSpeed))}`
            : `${formatTime(currentTime)} / ${formatTime(duration)}`}
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
});

export default AudioPlayer;
