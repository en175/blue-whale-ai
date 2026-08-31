import { type ReactNode, useEffect, useReducer, useRef, useState } from 'react';
import auroraVideo from '@/assets/home-hero/aurora.mp4';
import auroraPoster from '@/assets/home-hero/aurora-poster.jpg';
import ringVideo from '@/assets/home-hero/ring.mp4';
import ringPoster from '@/assets/home-hero/ring-poster.jpg';
import styles from './index.module.css';

export const HERO_TRANSITION_MS = 600;
export const HERO_PRELOAD_LEAD_SECONDS = 1;
export const HERO_TRANSITION_LEAD_SECONDS = HERO_TRANSITION_MS / 1000 + 0.05;

type SlotIndex = 0 | 1;

interface SlotState {
  slideIndex: number | null;
  ready: boolean;
}

interface CarouselState {
  activeSlot: SlotIndex;
  slots: [SlotState, SlotState];
  transitioning: boolean;
}

type CarouselAction =
  | { type: 'attach-current' }
  | { type: 'queue-next' }
  | { type: 'ready'; slot: SlotIndex }
  | { type: 'begin-transition' }
  | { type: 'commit-transition' }
  | { type: 'failed'; slot: SlotIndex }
  | { type: 'reset' };

const slides = [
  { video: auroraVideo, poster: auroraPoster },
  { video: ringVideo, poster: ringPoster },
] as const;

const initialState: CarouselState = {
  activeSlot: 0,
  slots: [
    { slideIndex: null, ready: false },
    { slideIndex: null, ready: false },
  ],
  transitioning: false,
};

function otherSlot(slot: SlotIndex): SlotIndex {
  return slot === 0 ? 1 : 0;
}

function carouselReducer(state: CarouselState, action: CarouselAction): CarouselState {
  switch (action.type) {
    case 'attach-current': {
      if (state.slots[state.activeSlot].slideIndex !== null) return state;
      const slots: [SlotState, SlotState] = [...state.slots];
      slots[state.activeSlot] = { slideIndex: 0, ready: false };
      return { ...state, slots };
    }
    case 'queue-next': {
      if (state.transitioning) return state;
      const standby = otherSlot(state.activeSlot);
      if (state.slots[standby].slideIndex !== null) return state;
      const currentSlide = state.slots[state.activeSlot].slideIndex ?? 0;
      const slots: [SlotState, SlotState] = [...state.slots];
      slots[standby] = {
        slideIndex: (currentSlide + 1) % slides.length,
        ready: false,
      };
      return { ...state, slots };
    }
    case 'ready': {
      const current = state.slots[action.slot];
      if (current.slideIndex === null || current.ready) return state;
      const slots: [SlotState, SlotState] = [...state.slots];
      slots[action.slot] = { ...current, ready: true };
      return { ...state, slots };
    }
    case 'begin-transition': {
      const standby = otherSlot(state.activeSlot);
      if (state.transitioning || !state.slots[standby].ready) return state;
      return { ...state, transitioning: true };
    }
    case 'commit-transition': {
      if (!state.transitioning) return state;
      const nextActive = otherSlot(state.activeSlot);
      if (!state.slots[nextActive].ready) return state;
      const slots: [SlotState, SlotState] = [...state.slots];
      slots[state.activeSlot] = { slideIndex: null, ready: false };
      return { activeSlot: nextActive, slots, transitioning: false };
    }
    case 'failed': {
      const slots: [SlotState, SlotState] = [...state.slots];
      if (action.slot === state.activeSlot) {
        slots[action.slot] = { ...slots[action.slot], ready: false };
      } else {
        slots[action.slot] = { slideIndex: null, ready: false };
      }
      return { ...state, slots };
    }
    case 'reset':
      return initialState;
  }
}

function safePlay(video: HTMLVideoElement): void {
  try {
    const result = video.play();
    void result?.catch(() => undefined);
  } catch {
    // 浏览器拒绝自动播放时保留静态封面，不让背景能力影响首页主流程。
  }
}

function assignedSource(video: HTMLVideoElement): string | null {
  return video.getAttribute('data-hero-src');
}

function assignSource(video: HTMLVideoElement, source: string): void {
  if (assignedSource(video) === source && video.hasAttribute('src')) return;
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute('data-hero-src', source);
  video.src = source;
  video.load();
}

function pauseAndUnload(video: HTMLVideoElement): void {
  video.pause();
  video.removeAttribute('data-hero-src');
  if (video.hasAttribute('src')) {
    video.removeAttribute('src');
    video.load();
  }
}

/** 片源时长未就绪或仍在片头时不预加载/切换，避免 metadata 抖动把三条片子连着切完。 */
function isNearEnd(video: HTMLVideoElement, leadSeconds: number): boolean {
  const duration = video.duration;
  const currentTime = video.currentTime;
  if (!Number.isFinite(duration) || duration < 2) return false;
  if (!Number.isFinite(currentTime) || currentTime < 0.35) return false;
  return duration - currentTime <= leadSeconds;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

export default function HeroVideoCarousel({ children }: { children?: ReactNode }) {
  const [state, dispatch] = useReducer(carouselReducer, initialState);
  const [idleReady, setIdleReady] = useState(false);
  const [inViewport, setInViewport] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== 'hidden');
  const reducedMotion = usePrefersReducedMotion();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mediaRefs = useRef<[HTMLVideoElement | null, HTMLVideoElement | null]>([null, null]);
  const stateRef = useRef(state);
  stateRef.current = state;

  const canAnimate = idleReady && inViewport && pageVisible && !reducedMotion;
  const canAnimateRef = useRef(canAnimate);
  canAnimateRef.current = canAnimate;

  useEffect(() => {
    if (window.requestIdleCallback) {
      const handle = window.requestIdleCallback(() => setIdleReady(true), { timeout: 1000 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(() => setIdleReady(true), 0);
    return () => window.clearTimeout(handle);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') {
      setInViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setInViewport(entry.isIntersecting && entry.intersectionRatio > 0),
      { threshold: 0.1 },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      dispatch({ type: 'reset' });
      mediaRefs.current.forEach((video) => video && pauseAndUnload(video));
    }
  }, [reducedMotion]);

  useEffect(() => {
    if (idleReady && inViewport && pageVisible && !reducedMotion) {
      dispatch({ type: 'attach-current' });
    }
  }, [idleReady, inViewport, pageVisible, reducedMotion]);

  const sourceKey0 = state.slots[0].slideIndex;
  const sourceKey1 = state.slots[1].slideIndex;
  useEffect(() => {
    [sourceKey0, sourceKey1].forEach((slideIndex, index) => {
      const video = mediaRefs.current[index];
      if (!video) return;
      const expectedSource = slideIndex === null ? null : slides[slideIndex].video;
      if (expectedSource) {
        assignSource(video, expectedSource);
      } else {
        pauseAndUnload(video);
      }
    });
  }, [sourceKey0, sourceKey1]);

  useEffect(() => {
    if (!canAnimate) {
      mediaRefs.current.forEach((video) => video?.pause());
      return;
    }
    const activeVideo = mediaRefs.current[state.activeSlot];
    if (activeVideo && state.slots[state.activeSlot].slideIndex !== null) safePlay(activeVideo);
    if (state.transitioning) {
      const standby = otherSlot(state.activeSlot);
      const standbyVideo = mediaRefs.current[standby];
      if (standbyVideo && state.slots[standby].ready) safePlay(standbyVideo);
    }
  }, [canAnimate, state.activeSlot, state.slots, state.transitioning]);

  useEffect(() => {
    if (!state.transitioning) return;
    const enteringSlot = otherSlot(state.activeSlot);
    const enteringVideo = mediaRefs.current[enteringSlot];
    if (enteringVideo && canAnimateRef.current) safePlay(enteringVideo);
    const handle = window.setTimeout(() => {
      dispatch({ type: 'commit-transition' });
    }, HERO_TRANSITION_MS);
    return () => window.clearTimeout(handle);
  }, [state.activeSlot, state.transitioning]);

  useEffect(() => {
    if (state.transitioning) return;
    const standby = otherSlot(state.activeSlot);
    if (!state.slots[standby].ready) return;
    const activeVideo = mediaRefs.current[state.activeSlot];
    if (activeVideo && (activeVideo.ended || isNearEnd(activeVideo, HERO_TRANSITION_LEAD_SECONDS))) {
      dispatch({ type: 'begin-transition' });
    }
  }, [state.activeSlot, state.slots, state.transitioning]);

  useEffect(
    () => () => {
      mediaRefs.current.forEach((video) => video && pauseAndUnload(video));
    },
    [],
  );

  const markReady = (slot: SlotIndex) => {
    if (stateRef.current.slots[slot].slideIndex === null) return;
    dispatch({ type: 'ready', slot });
  };

  const onTimeUpdate = (slot: SlotIndex) => {
    const snapshot = stateRef.current;
    if (slot !== snapshot.activeSlot || snapshot.transitioning) return;
    const video = mediaRefs.current[slot];
    if (!video) return;
    if (isNearEnd(video, HERO_PRELOAD_LEAD_SECONDS)) dispatch({ type: 'queue-next' });
    const standby = otherSlot(snapshot.activeSlot);
    if (snapshot.slots[standby].ready && isNearEnd(video, HERO_TRANSITION_LEAD_SECONDS)) {
      dispatch({ type: 'begin-transition' });
    }
  };

  const onEnded = (slot: SlotIndex) => {
    const snapshot = stateRef.current;
    if (slot !== snapshot.activeSlot || snapshot.transitioning) return;
    dispatch({ type: 'queue-next' });
    const standby = otherSlot(snapshot.activeSlot);
    if (snapshot.slots[standby].ready) {
      dispatch({ type: 'begin-transition' });
      return;
    }
    const video = mediaRefs.current[slot];
    if (video) {
      video.currentTime = 0;
      if (canAnimateRef.current) safePlay(video);
    }
  };

  const onError = (slot: SlotIndex) => {
    const snapshot = stateRef.current;
    if (snapshot.slots[slot].slideIndex === null) return;
    dispatch({ type: 'failed', slot });
    if (slot === snapshot.activeSlot && !snapshot.transitioning) {
      dispatch({ type: 'queue-next' });
    }
  };

  return (
    <section ref={rootRef} className={styles.carousel} data-testid="hero-video-carousel">
      <img
        className={styles.poster}
        src={slides[0].poster}
        alt=""
        width={1920}
        height={1080}
        decoding="async"
        aria-hidden="true"
      />
      {state.slots.map((slot, index) => {
        const slotIndex = index as SlotIndex;
        const isEntering = state.transitioning && slotIndex === otherSlot(state.activeSlot);
        const isVisible = slot.ready && (slotIndex === state.activeSlot || isEntering);
        const isLeaving = state.transitioning && slotIndex === state.activeSlot;
        return (
          <video
            key={slotIndex}
            ref={(node) => { mediaRefs.current[slotIndex] = node; }}
            className={`${styles.video} ${isVisible && !isLeaving ? styles.videoVisible : ''}`}
            muted
            playsInline
            preload="none"
            controls={false}
            disablePictureInPicture
            aria-hidden="true"
            tabIndex={-1}
            onLoadedData={() => markReady(slotIndex)}
            onCanPlay={() => markReady(slotIndex)}
            onPlaying={() => markReady(slotIndex)}
            onTimeUpdate={() => onTimeUpdate(slotIndex)}
            onEnded={() => onEnded(slotIndex)}
            onError={() => onError(slotIndex)}
          />
        );
      })}
      <div className={styles.scrim} aria-hidden="true" />
      {children ? <div className={styles.content}>{children}</div> : null}
    </section>
  );
}
