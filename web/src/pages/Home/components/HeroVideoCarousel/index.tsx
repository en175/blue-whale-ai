import { type ReactNode, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import auroraPoster from '@/assets/home-hero/aurora-poster.jpg';
import {
  publicHomepageHeroesOptions,
  selectPlayableHeroSlides,
  type HeroSlide,
} from '@/api/homepageHeroes';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/utils/remoteImageCors';
import styles from './index.module.css';

export const HERO_TRANSITION_MS = 600;
export const HERO_PRELOAD_LEAD_SECONDS = 1;
export const HERO_TRANSITION_LEAD_SECONDS = HERO_TRANSITION_MS / 1000 + 0.05;
export const HERO_IMAGE_HOLD_MS = 8000;

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
  | { type: 'attach-current'; slideCount: number }
  | { type: 'queue-next'; nextIndex: number }
  | { type: 'ready'; slot: SlotIndex }
  | { type: 'begin-transition' }
  | { type: 'commit-transition' }
  | { type: 'failed'; slot: SlotIndex }
  | { type: 'reset' };

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
      if (action.slideCount <= 0) return state;
      if (state.slots[state.activeSlot].slideIndex !== null) return state;
      const slots: [SlotState, SlotState] = [...state.slots];
      slots[state.activeSlot] = { slideIndex: 0, ready: false };
      return { ...state, slots };
    }
    case 'queue-next': {
      if (state.transitioning) return state;
      const standby = otherSlot(state.activeSlot);
      if (state.slots[standby].slideIndex !== null) return state;
      const slots: [SlotState, SlotState] = [...state.slots];
      slots[standby] = {
        slideIndex: action.nextIndex,
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
  video.loop = false;
  video.setAttribute('data-hero-src', source);
  video.src = source;
  video.load();
}

function rewindToStart(video: HTMLVideoElement): void {
  try {
    if (video.currentTime !== 0) video.currentTime = 0;
  } catch {
    // metadata 未就绪时无法seek，交给随后的 load / canplay。
  }
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

function posterOf(slide: HeroSlide | undefined, fallback: string): string {
  if (!slide) return fallback;
  if (slide.poster) return slide.poster;
  if (slide.mediaType === 'image') return slide.src;
  return fallback;
}

function nextIndex(current: number, length: number): number {
  if (length <= 0) return 0;
  return (current + 1) % length;
}

export function HeroCarouselView({
  children,
  slides,
  fallbackPoster,
}: {
  children?: ReactNode;
  slides: HeroSlide[];
  fallbackPoster: string;
}) {
  const [state, dispatch] = useReducer(carouselReducer, initialState);
  const [idleReady, setIdleReady] = useState(false);
  const [inViewport, setInViewport] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== 'hidden');
  const reducedMotion = usePrefersReducedMotion();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mediaRefs = useRef<[HTMLVideoElement | HTMLImageElement | null, HTMLVideoElement | HTMLImageElement | null]>([null, null]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const slidesRef = useRef(slides);
  slidesRef.current = slides;
  const slidesSignature = slides.map((slide) => `${slide.id}:${slide.src}`).join('|');

  const canAnimate = idleReady && inViewport && pageVisible && !reducedMotion && slides.length > 0;
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
    dispatch({ type: 'reset' });
    mediaRefs.current.forEach((el) => {
      if (el instanceof HTMLVideoElement) pauseAndUnload(el);
    });
  }, [slidesSignature]);

  useEffect(() => {
    if (reducedMotion) {
      dispatch({ type: 'reset' });
      mediaRefs.current.forEach((el) => {
        if (el instanceof HTMLVideoElement) pauseAndUnload(el);
      });
    }
  }, [reducedMotion]);

  useEffect(() => {
    if (idleReady && inViewport && pageVisible && !reducedMotion && slides.length > 0) {
      dispatch({ type: 'attach-current', slideCount: slides.length });
    }
  }, [idleReady, inViewport, pageVisible, reducedMotion, slides.length, slidesSignature]);

  const sourceKey0 = state.slots[0].slideIndex;
  const sourceKey1 = state.slots[1].slideIndex;
  useEffect(() => {
    [sourceKey0, sourceKey1].forEach((slideIndex, index) => {
      const el = mediaRefs.current[index];
      const slide = slideIndex === null ? null : slides[slideIndex];
      if (!(el instanceof HTMLVideoElement)) return;
      if (slide?.mediaType === 'video') {
        assignSource(el, slide.src);
      } else {
        pauseAndUnload(el);
      }
    });
  }, [sourceKey0, sourceKey1, slides, slidesSignature]);

  useEffect(() => {
    if (!canAnimate) {
      mediaRefs.current.forEach((el) => {
        if (el instanceof HTMLVideoElement) el.pause();
      });
      return;
    }
    const activeEl = mediaRefs.current[state.activeSlot];
    if (activeEl instanceof HTMLVideoElement && state.slots[state.activeSlot].slideIndex !== null) {
      safePlay(activeEl);
    }
    if (state.transitioning) {
      const standby = otherSlot(state.activeSlot);
      const standbyEl = mediaRefs.current[standby];
      if (standbyEl instanceof HTMLVideoElement && state.slots[standby].ready) safePlay(standbyEl);
    }
  }, [canAnimate, state.activeSlot, state.slots, state.transitioning]);

  useEffect(() => {
    if (!state.transitioning) return;
    const enteringSlot = otherSlot(state.activeSlot);
    const enteringEl = mediaRefs.current[enteringSlot];
    if (enteringEl instanceof HTMLVideoElement && canAnimateRef.current) {
      rewindToStart(enteringEl);
      safePlay(enteringEl);
    }
    const handle = window.setTimeout(() => {
      dispatch({ type: 'commit-transition' });
    }, HERO_TRANSITION_MS);
    return () => window.clearTimeout(handle);
  }, [state.activeSlot, state.transitioning]);

  useEffect(() => {
    if (state.transitioning) return;
    const standby = otherSlot(state.activeSlot);
    if (!state.slots[standby].ready) return;
    const activeEl = mediaRefs.current[state.activeSlot];
    if (activeEl instanceof HTMLVideoElement && (activeEl.ended || isNearEnd(activeEl, HERO_TRANSITION_LEAD_SECONDS))) {
      dispatch({ type: 'begin-transition' });
    }
  }, [state.activeSlot, state.slots, state.transitioning]);

  const activeSlideIndex = state.slots[state.activeSlot].slideIndex;
  const activeReady = state.slots[state.activeSlot].ready;
  useEffect(() => {
    if (!canAnimate || state.transitioning || !activeReady || activeSlideIndex === null) return;
    const slide = slides[activeSlideIndex];
    if (slide?.mediaType !== 'image') return;
    if (slides.length <= 1) return;
    const preloadAt = Math.max(0, HERO_IMAGE_HOLD_MS - HERO_PRELOAD_LEAD_SECONDS * 1000);
    const preloadHandle = window.setTimeout(() => {
      const snapshot = stateRef.current;
      const current = snapshot.slots[snapshot.activeSlot].slideIndex ?? 0;
      dispatch({ type: 'queue-next', nextIndex: nextIndex(current, slidesRef.current.length) });
    }, preloadAt);
    const transHandle = window.setTimeout(() => {
      dispatch({ type: 'begin-transition' });
    }, HERO_IMAGE_HOLD_MS);
    return () => {
      window.clearTimeout(preloadHandle);
      window.clearTimeout(transHandle);
    };
  }, [canAnimate, state.transitioning, activeReady, activeSlideIndex, slides, slidesSignature]);

  useEffect(
    () => () => {
      mediaRefs.current.forEach((el) => {
        if (el instanceof HTMLVideoElement) pauseAndUnload(el);
      });
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
    const el = mediaRefs.current[slot];
    if (!(el instanceof HTMLVideoElement)) return;
    const length = slidesRef.current.length;
    if (isNearEnd(el, HERO_PRELOAD_LEAD_SECONDS)) {
      const current = snapshot.slots[snapshot.activeSlot].slideIndex ?? 0;
      dispatch({ type: 'queue-next', nextIndex: nextIndex(current, length) });
    }
    const standby = otherSlot(snapshot.activeSlot);
    if (snapshot.slots[standby].ready && isNearEnd(el, HERO_TRANSITION_LEAD_SECONDS)) {
      dispatch({ type: 'begin-transition' });
    }
  };

  const onEnded = (slot: SlotIndex) => {
    const snapshot = stateRef.current;
    if (slot !== snapshot.activeSlot || snapshot.transitioning) return;
    const length = slidesRef.current.length;
    const current = snapshot.slots[snapshot.activeSlot].slideIndex ?? 0;
    dispatch({ type: 'queue-next', nextIndex: nextIndex(current, length) });
    const standby = otherSlot(snapshot.activeSlot);
    if (snapshot.slots[standby].ready) {
      dispatch({ type: 'begin-transition' });
      return;
    }
    const el = mediaRefs.current[slot];
    if (el instanceof HTMLVideoElement) {
      el.currentTime = 0;
      if (canAnimateRef.current) safePlay(el);
    }
  };

  const onError = (slot: SlotIndex) => {
    const snapshot = stateRef.current;
    if (snapshot.slots[slot].slideIndex === null) return;
    dispatch({ type: 'failed', slot });
    if (slot === snapshot.activeSlot && !snapshot.transitioning) {
      const current = snapshot.slots[snapshot.activeSlot].slideIndex ?? 0;
      dispatch({ type: 'queue-next', nextIndex: nextIndex(current, slidesRef.current.length) });
    }
  };

  const posterSrc = posterOf(slides[0], fallbackPoster);

  return (
    <section ref={rootRef} className={styles.carousel} data-testid="hero-video-carousel">
      <img
        className={styles.poster}
        src={resolveMediaSrc(posterSrc)}
        crossOrigin={remoteImageCrossOrigin(posterSrc)}
        alt=""
        width={1920}
        height={1080}
        decoding="async"
        aria-hidden="true"
      />
      {state.slots.map((slot, index) => {
        const slotIndex = index as SlotIndex;
        const slide = slot.slideIndex === null ? null : slides[slot.slideIndex];
        const isEntering = state.transitioning && slotIndex === otherSlot(state.activeSlot);
        const isVisible = slot.ready && (slotIndex === state.activeSlot || isEntering);
        const isLeaving = state.transitioning && slotIndex === state.activeSlot;
        const layerClass = `${styles.video} ${isVisible && !isLeaving ? styles.videoVisible : ''}`;
        if (slide?.mediaType === 'image') {
          return (
            <img
              key={`img-${slotIndex}`}
              ref={(node) => { mediaRefs.current[slotIndex] = node; }}
              className={layerClass}
              src={resolveMediaSrc(slide.src)}
              crossOrigin={remoteImageCrossOrigin(slide.src)}
              alt=""
              decoding="async"
              aria-hidden="true"
              onLoad={() => markReady(slotIndex)}
              onError={() => onError(slotIndex)}
            />
          );
        }
        return (
          <video
            key={`video-${slotIndex}`}
            ref={(node) => { mediaRefs.current[slotIndex] = node; }}
            className={layerClass}
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

export default function HeroVideoCarousel({ children }: { children?: ReactNode }) {
  const heroes = useQuery(publicHomepageHeroesOptions());
  const slides = useMemo(() => selectPlayableHeroSlides(heroes.data), [heroes.data]);
  return (
    <HeroCarouselView slides={slides} fallbackPoster={auroraPoster}>
      {children}
    </HeroCarouselView>
  );
}
