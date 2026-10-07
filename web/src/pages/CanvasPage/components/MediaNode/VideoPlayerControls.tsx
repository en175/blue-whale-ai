/* ============================================
 * VideoPlayerControls：视频卡自绘播放控件（IKI5YM）
 * 原生 <video controls> 的控制条在 shadow DOM 内，无法只对画面区放行指针——
 * 「保住播放控制」与「画面区可拖」在原生控件下互斥。改为对齐 AudioPlayer 先例：
 * 画面区裸给 React Flow（可拖整卡），播放能力由本控件承担，nodrag/nopan 只挂
 * 播放钮与进度轨等交互子元素。叠加于画面底部，层级低于编辑态锁定层
 * （splitEditing zIndex 5）——编辑期间控件不可达。
 * ============================================ */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import { formatTime, toggleVideoPlayback } from './mediaPlayback';
import styles from './index.module.css';

interface VideoPlayerControlsProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** 服务端权威时长（秒，对齐 AudioPlayer 口径）：有值时优先于浏览器实测 */
  duration?: number;
}

export default function VideoPlayerControls({ videoRef, duration: authoritativeDuration }: VideoPlayerControlsProps) {
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(authoritativeDuration ?? 0);
  const [currentTime, setCurrentTime] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  /** 服务端权威时长优先；缺失时挂载即读浏览器实测兜底——收养会话（IKI5YM 审查修订）
   *  叠加控件前 loadedmetadata 已派发、不会重放，只等事件会让收养路径时长停在 0；
   *  metadata 晚于控件挂载的树内路径仍由事件监听补齐 */
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

  /** 播放状态与进度随 video 元素事件同步：画面点击/按钮/ended 全走同一条状态链。
   *  挂载/ref 更换即对齐元素当前状态：收养会话（IKI5YM 审查修订）叠加控件时元素已在播，
   *  只靠事件会把播放中的卡显示成「播放」钮；树内路元素新挂载恒暂停，读到同一初值。 */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setPlaying(!video.paused);
    setCurrentTime(video.currentTime); // 与上一行对称：收养叠加瞬间进度/时间直接显示实际位置
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

  /** 进度轨点按/拖拽 seek（口径对齐 AudioPlayer.handleTrackDown：mousedown 起拖、
   *  document 级 move/up 收尾；nodrag 保证不落入节点拖拽路径） */
  const handleTrackDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    // preventDefault 会吞掉 mousedown 的默认聚焦，须手动补回——否则点按轨道后方向键 seek 无响应
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

  /** 进度轨键盘 seek（WAI-ARIA slider 契约）：左右方向键按总时长 5%（至少 1s）步进 */
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
