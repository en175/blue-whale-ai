/* ============================================
 * AudioPlayer：画布音频节点的自包含播放器
 * 深灰卡片 + 暗色波形区 + 播放控制，样式参考设计稿
 * IKHB7A 截取编辑态（父单 IKHB08）：扩选区 props 承载试听钳制——从选区头起播、
 * 播放中到选区尾自动停且播放头停终点、再点播放重新从选区头播、选区变化（拖抓手/
 * 进入编辑态）即暂停且播放头被挤出选区时钳回边界；进入编辑态（selection 由 null
 * 变非 null）播放头归零。定位条（红色 playhead）在选区内可点可拖由卡内遮罩层
 * （AudioTrimOverlay）接管，经父级（MediaNode）桥接本组件命令式句柄 seek。
 * IKHW5S 调速试听（父单 IKHVYO）：扩 speedFactor props——playbackRate + preservesPitch
 * 按所选倍速播放（音调自然），播放中拖滑杆只改 rate 不中断，退出恢复 1.0；卡内时间行
 * 按倍速折算预览产物时长（播放头位置按源波形不动）。调速无遮罩，波形点击/按住拖拽
 * 定位走本组件既有 handleTrackDown（只定位不改播放状态：播放中拖完续播、暂停态保持
 * 暂停，同 ADR-0111 定位条口径）。
 * ============================================ */
import { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Play, Pause } from 'lucide-react';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/utils/remoteImageCors';
import styles from './index.module.css';
/** 截取选区（秒，内部全精度；形状对齐 audioTrimGeometry.AudioTrimSelection，
 *  此处本地声明避免无谓依赖方向）。 */
export interface AudioPlayerTrimSelection {
  start: number;
  end: number;
}

/** 命令式句柄（MediaNode 桥接卡内遮罩层定位条拖拽用；拖拽为高频命令式 seek，
 *  走 state 会为每次 mousemove 重排整卡，先例是遮罩层族「事件上抛+受控渲染」，
 *  音频 seek 天然非受控，ref 桥是最小形态）。 */
export interface AudioPlayerHandle {
  /** 定位条 seek（遮罩层已按选区钳制）：更新播放头。 */
  seekTo(time: number): void;
  /** 暂停播放，返回暂停前是否在播放（wasPlaying，供松手续播判定）。 */
  pause(): boolean;
  /** 从指定位置起播（定位条拖拽松手续播）。 */
  playFrom(time: number): void;
}

interface AudioPlayerProps {
  src: string;
  fileName?: string;
  /** 服务端权威时长（秒，story 15）：有值时优先于浏览器实测（ogg/flac 等格式 metadata 支持不稳） */
  duration?: number;
  onDownload?: () => void;
  /** 调速编辑态骨架标记（IKHW5C）：true 即编辑态——false→true（进入）暂停+播放头
   *  归零（对齐截取编辑态进入手势 IKHB7A 口径）；退出标记移除即恢复。 */
  speedEditing?: boolean;
  /** 调速试听倍速（IKHW5S，父单 IKHVYO）：编辑态 = 当前滑杆倍速——audio.playbackRate
   *  按其播放、preservesPitch 保持音调（父单实现决策 6，与火山算法同向）；播放中变化
   *  只改 rate 不中断（不碰 currentTime/播放状态）；undefined（退出）恢复 1.0。卡内
   *  时间行编辑态按其折算且先 round 再进 formatTime（fmt(round(current/speed)) /
   *  fmt(round(duration/speed))，规格用户故事 23 口径），播放头位置按源波形不动。 */
  speedFactor?: number;
  /** 截取编辑态选区（IKHB7A）：非 null 即编辑态——进入（null→非 null）暂停+播放头
   *  归零；选区变化（拖抓手）暂停+播放头被挤出时钳回边界；试听钳制见头注。 */
  trimSelection?: AudioPlayerTrimSelection | null;
  /** 截取遮罩插槽（IKHB7A）：渲染在波形区内（贴合原型 .ovl 于 wave-inner 的结构，
   *  遮罩天然只覆盖波形区、底部播放控制仍可用）；层内消化指针不冒泡开音频面板。 */
  trimOverlay?: React.ReactNode;
}

export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** 波形竖条数：480×240 横矩形下 72 根细密观感（IKH8PU，对齐原型 audio-card-landscape） */
const BARS = 72;

/** 从真实音频解码数据生成波形条高度百分比（RMS 归一化） */
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
    // 服务端权威值优先（对齐 video 路径「已有值不覆盖」先例），仅缺失时用浏览器实测兜底
    if (audioRef.current && authoritativeDuration == null) setDuration(audioRef.current.duration || 0);
  }, [authoritativeDuration]);

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
    if (a) {
      // 编辑态试听钳制：到选区尾自动停且播放头停终点（原型 tick 编辑态分支）
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

  /** 调速编辑态进入手势（IKHW5C 骨架）：false→true 暂停 + 播放头归零（对齐截取
   *  编辑态「进入即暂停、播放头归零」IKHB7A 口径，从一致的起始状态开始试听）。
   *  依赖布尔稳定值不靠引用比较；退出（true→false）复位由下方倍速 effect 承担
   *  （rate 回 1.0，IKHW5S）。 */
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

  /** 调速试听倍速（IKHW5S）：playbackRate 实时跟随滑杆（播放中拖动只改 rate 不中断、
   *  不碰 currentTime），preservesPitch 保持音调自然（父单实现决策 6，webkit 前缀兼容
   *  旧 Safari）；speedFactor 缺失（非编辑态/退出）恢复 1.0——退出复位归本 effect。 */
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const rate = typeof speedFactor === 'number' && speedFactor > 0 ? speedFactor : 1;
    a.playbackRate = rate;
    const pitched = a as HTMLAudioElement & { webkitPreservesPitch?: boolean };
    if ('preservesPitch' in a) a.preservesPitch = true;
    pitched.webkitPreservesPitch = true;
  }, [speedFactor]);

  /** 折算倍速（时间行展示用）：speedFactor 合法值直接用，否则 1（非编辑态/退出恢复）。 */
  const effectiveSpeed = typeof speedFactor === 'number' && speedFactor > 0 ? speedFactor : 1;

  /** 截取编辑态手势（进入/拖抓手）统一暂停与播放头钳制（IKHB7A）：
   *  - null → 非 null（进入编辑态）：暂停 + 播放头归零（红色定位条归零）；
   *  - 非 null 间变化（拖抓手改选区）：暂停（拖任一抓手即暂停），播放头被挤出
   *    新选区时钳回最近边界。
   *  依赖 trimSelection（引用比较）触发，但值未变（起止秒数相同）时早退——父级每轮
   *  渲染若重建选区对象，不能构成「选区变化」触发暂停（回归：编辑态点播放被打断）。 */
  const prevSelectionRef = useRef<AudioPlayerTrimSelection | null>(null);
  useEffect(() => {
    const a = audioRef.current;
    const prev = prevSelectionRef.current;
    prevSelectionRef.current = trimSelection ?? null;
    if (!a || !trimSelection) return;
    if (prev && prev.start === trimSelection.start && prev.end === trimSelection.end) return;
    if (!a.paused) a.pause();
    if (prev == null) {
      // 进入编辑态：播放头归零
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

  /** 命令式句柄：卡内遮罩层定位条拖拽经 MediaNode 桥接（见 AudioPlayerHandle 头注） */
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
      // 编辑态试听：从选区头起播（播放头不在选区内时归到选区起点，原型 btnPlay 分支）
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
      let t = r * duration;
      // 编辑态定位条钳制（IKHB7A）：选区内可点可拖，越界钳回边界（原型 phSeekFromEvent）
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

  // 不拦截点击：主体点击需冒泡到节点，才能打开音频对话框（与标题区域一致）
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

      {/* 暗色波形区：可点击拖拽 seek；红色 playhead 指示当前进度。
          编辑态下波形区被卡内遮罩层（AudioTrimOverlay）覆盖接管，本层不收事件 */}
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
        {/* 截取遮罩四件套（编辑态注入）：白选区框/抓手/暗区/秒数胶囊，接管波形区指针 */}
        {trimOverlay}
      </div>

      {/* 底部控制区：时间 + 播放按钮（卡内时间行 = 当前试听位置 / 总时长；
          调速编辑态按倍速折算预览产物时长——折算值先 Math.round 再进 formatTime
          （规格 IKHVYO 用户故事 23 例证：12s @1.35x ≈ 8.89 → 显示 09 秒，round 口径），
          只改调速路径；非编辑态保持既有 floor 显示，退出恢复源时长） */}
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

/** 截取遮罩定位条 → 播放器命令式桥（IKHB7A，MediaNode 消费）：遮罩层只报时点，暂停/
 *  续播语义在此组装——按下暂停记 wasPlaying；松手按 wasPlaying 与「未拖到选区尾」续播
 *  （拖到尾 = 停在终点，等价自动暂停，rAF tick 会收敛到终点）。拖拽为高频命令式 seek，
 *  state 桥会逐帧重排整卡，ref 桥是最小形态。 */
export function useAudioTrimSeekBridge() {
  const playerRef = useRef<AudioPlayerHandle | null>(null);
  const wasPlayingRef = useRef(false);
  const onSeekStart = useCallback(() => {
    wasPlayingRef.current = playerRef.current?.pause() ?? false;
  }, []);
  const onSeek = useCallback((time: number) => {
    playerRef.current?.seekTo(time);
  }, []);
  const onSeekEnd = useCallback((time: number, selectionEnd?: number) => {
    const wasPlaying = wasPlayingRef.current;
    wasPlayingRef.current = false;
    if (wasPlaying && selectionEnd != null && time < selectionEnd - 1e-6) {
      playerRef.current?.playFrom(time);
    }
  }, []);
  return { playerRef, onSeekStart, onSeek, onSeekEnd };
}
