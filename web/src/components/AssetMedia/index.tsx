/* ============================================
 * AssetMedia 共享媒体组件：统一处理 image/video/audio 的 loading/loaded/error 三态
 * （从 Assets 页抽离，资产库网格与资产详情弹窗共用）
 * ============================================ */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Play, RotateCw, AlertCircle } from 'lucide-react';
import type { AssetRecord } from '@/api/assets';
import styles from './index.module.css';

/** 媒体加载状态 */
export type MediaLoadState = 'waiting' | 'loading' | 'loaded' | 'error';

/** 单个资产媒体组件：统一处理 loading / loaded / error 三态 */
export function AssetMedia({ asset }: { asset: AssetRecord }) {
  const isSafari = isSafariBrowser();
  // Safari 视频初始为 waiting（懒加载），其余直接进入 loading
  const [state, setState] = useState<MediaLoadState>(
    asset.type === 'video' && isSafari ? 'waiting' : 'loading',
  );
  const [reloadKey, setReloadKey] = useState(0);

  // URL 或 reloadKey 变化时重置为 loading（视频通过 VideoThumb 的 onLoaded/onError 驱动状态）
  useEffect(() => {
    if (asset.type !== 'video') {
      setState('loading');
    }
  }, [asset.url, reloadKey, asset.type]);

  const handleReload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setReloadKey((k) => k + 1);
    // Safari 视频重试需回到 waiting 让 IntersectionObserver 重新触发；其余直接 loading
    if (asset.type === 'video' && isSafari) {
      setState('waiting');
    } else {
      setState('loading');
    }
  }, [asset.type, isSafari]);

  const mediaSrc = `${asset.url}${asset.url.includes('?') ? '&' : '?'}_reload=${reloadKey}`;

  return (
    <>
      {/* loading 遮罩（图片/音频） */}
      {state === 'loading' && (
        <div className={styles.mediaLoading}>
          <Loader2 size={24} className={styles.spinner} />
        </div>
      )}

      {/* waiting 遮罩（视频未进入视口）：显示半透明背景，无 spinner，减轻视觉负担 */}
      {state === 'waiting' && (
        <div className={styles.mediaLoading} style={{ opacity: 0.3 }}>
          <Loader2 size={24} className={styles.spinner} />
        </div>
      )}

      {/* error 遮罩 + 重试按钮 */}
      {state === 'error' && (
        <div className={styles.mediaError}>
          <AlertCircle size={28} />
          <span className={styles.mediaErrorText}>加载失败</span>
          <button className={styles.mediaRetryBtn} onClick={handleReload} title="重新加载">
            <RotateCw size={14} />
            <span>点击重试</span>
          </button>
        </div>
      )}

      {/* 实际媒体元素 */}
      {asset.type === 'image' && asset.url && (
        <img
          className={styles.media}
          src={mediaSrc}
          alt=""
          loading="lazy"
          onLoad={() => setState('loaded')}
          onError={() => setState('error')}
        />
      )}
      {asset.type === 'video' && asset.url && (
        <VideoThumb
          url={mediaSrc}
          onInView={() => setState('loading')}
          onLoaded={() => setState('loaded')}
          onError={() => setState('error')}
        />
      )}
      {asset.type === 'audio' && asset.url && (
        <audio
          className={styles.audioPlayer}
          src={mediaSrc}
          controls
          preload="metadata"
          onLoadedData={() => setState('loaded')}
          onError={() => setState('error')}
        />
      )}
    </>
  );
}

/** 检测是否为 Safari 浏览器（不包含 Chrome/Chromium/Edge 等基于 Safari 的浏览器） */
export function isSafariBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // Safari 的特征：包含 Safari 但不包含 Chrome/Chromium/Edge/OPR
  return /^((?!chrome|android|edge|opr|crios).)*safari/i.test(ua);
}

/** 视频缩略图：Safari 下使用 IntersectionObserver 懒加载（避免并发请求超时），其他浏览器直接加载保持原有体验 */
export function VideoThumb({
  url,
  onLoaded,
  onError,
  onInView,
}: {
  url: string;
  onLoaded?: () => void;
  onError?: () => void;
  onInView?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [inView, setInView] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const useLazy = isSafariBrowser();

  // Safari 下：IntersectionObserver 懒加载，视频进入视口才请求
  useEffect(() => {
    if (!useLazy) {
      // 非 Safari：直接加载，跳过 IO 检测，通知父组件切换到 loading 态
      setInView(true);
      onInView?.();
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          onInView?.();
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [useLazy, onInView]);

  // 关键修复：检测缓存视频的 readyState，避免 onLoadedData 事件因竞态丢失
  // 当视频从浏览器缓存加载时，loadeddata 事件可能在 React 合成事件绑定之前就已触发
  useEffect(() => {
    if (!inView) return;
    const video = videoRef.current;
    if (!video) return;

    const checkReady = () => {
      // readyState >= 2 表示 HAVE_CURRENT_DATA（首帧已就绪）
      if (video.readyState >= 2) {
        onLoaded?.();
      }
    };

    // 立即检查（处理缓存场景，事件可能已触发过）
    checkReady();

    // 同时绑定原生事件监听作为兜底
    video.addEventListener('loadeddata', checkReady);
    return () => video.removeEventListener('loadeddata', checkReady);
  }, [inView, onLoaded]);

  const startPlay = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    void video.play().catch(() => setPlaying(false));
  };

  return (
    <>
      <div ref={containerRef} className={styles.videoContainer}>
        <video
          ref={videoRef}
          className={styles.media}
          src={inView ? url : undefined}
          muted
          playsInline
          preload="metadata"
          controls={playing}
          onLoadedData={() => onLoaded?.()}
          onError={() => onError?.()}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onClick={() => {
            if (!playing) startPlay();
          }}
        />
      </div>
      {!playing && inView && (
        <button type="button" className={styles.playIcon} title="播放视频" onClick={startPlay}>
          <Play size={22} fill="#fff" strokeWidth={0} />
        </button>
      )}
    </>
  );
}
