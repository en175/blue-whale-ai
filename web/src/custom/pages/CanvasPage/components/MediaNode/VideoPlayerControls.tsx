import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import { formatTime, toggleVideoPlayback } from './mediaPlayback';
import styles from './index.module.css';

interface VideoPlayerControlsProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  duration?: number;
}

export default function VideoPlayerControls({ videoRef, duration: authoritativeDuration }: VideoPlayerControlsProps) {
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(authoritativeDuration ?? 0);
  const [currentTime, setCurrentTime] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDuration(authoritativeDuration ?? 0);
    if (authoritativeDuration != null) return;
    const video = videoRef.current;
    if (!video) return;
    const onLoaded = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) setDuration(video.duration);
    };
    onLoaded();
    video.addEventListener('loadedmetadata', onLoaded);
    return () => video.removeEventListener('loadedmetadata', onLoaded);
  }, [videoRef, authoritativeDuration]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setPlaying(!video.paused);
    setCurrentTime(video.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setCurrentTime(video.currentTime);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onPause);
    video.addEventListener('timeupdate', onTime);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onPause);
      video.removeEventListener('timeupdate', onTime);
    };
  }, [videoRef]);

  const toggle = useCallback(() => toggleVideoPlayback(videoRef.current), [videoRef]);

  const handleTrackDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    trackRef.current?.focus({ preventScroll: true });
    const video = videoRef.current;
    if (!video || !duration) return;
    const seekTo = (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const t = ratio * duration;
      video.currentTime = t;
      setCurrentTime(t);
    };
    seekTo(e.clientX);
    const handleMove = (ev: MouseEvent) => seekTo(ev.clientX);
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [videoRef, duration]);

  const handleTrackKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video || !duration) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = Math.max(1, duration * 0.05);
    const delta = e.key === 'ArrowRight' ? step : -step;
    const t = Math.min(duration, Math.max(0, video.currentTime + delta));
    video.currentTime = t;
    setCurrentTime(t);
  }, [videoRef, duration]);

  const progressPct = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className={styles.videoControlsBar}>
      <button
        type="button"
        className={`${styles.videoPlayBtn} nodrag nopan`}
        onClick={toggle}
        aria-label={playing ? '暂停' : '播放'}
      >
        {playing
          ? <Pause size={16} strokeWidth={2.5} color="#fff" />
          : <Play size={16} strokeWidth={2.5} color="#fff" style={{ marginLeft: 2 }} />}
      </button>
      <div
        className={`${styles.videoTrack} nodrag nopan`}
        ref={trackRef}
        data-testid="video-seek-track"
        role="slider"
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
        tabIndex={0}
        onMouseDown={handleTrackDown}
        onKeyDown={handleTrackKeyDown}
      >
        <div className={styles.videoTrackFill} style={{ width: `${progressPct}%` }} />
      </div>
      <span className={styles.videoTime}>{formatTime(currentTime)} / {formatTime(duration)}</span>
    </div>
  );
}
