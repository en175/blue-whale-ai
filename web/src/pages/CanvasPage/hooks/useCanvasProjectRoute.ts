import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { canvasLocationSearch, readCanvasIdFromSearch } from '../canvasQuery';

export function useCanvasProjectRoute(input: {
  currentId: string;
  setCurrentId: Dispatch<SetStateAction<string>>;
  location: { pathname: string; search: string; state: unknown };
  navigate: (to: { pathname: string; search: string }, options: { replace: boolean; state: unknown }) => void;
  audioMixInFlightRef: RefObject<boolean>;
  activeProjectRef: RefObject<string>;
  blockedByPendingCanvasReviewRef: RefObject<() => boolean>;
  onProjectSwitch: () => void;
}): void {
  const {
    currentId,
    setCurrentId,
    location,
    navigate,
    audioMixInFlightRef,
    activeProjectRef,
    blockedByPendingCanvasReviewRef,
    onProjectSwitch,
  } = input;
  const onProjectSwitchRef = useRef(onProjectSwitch);
  onProjectSwitchRef.current = onProjectSwitch;
  useEffect(() => {
    const fromQuery = readCanvasIdFromSearch(new URLSearchParams(location.search));
    if (fromQuery && audioMixInFlightRef.current && activeProjectRef.current && fromQuery !== activeProjectRef.current) {
      navigate({ pathname: location.pathname, search: canvasLocationSearch(new URLSearchParams(location.search), activeProjectRef.current) },
        { replace: true, state: location.state });
      return;
    }
    if (fromQuery && activeProjectRef.current && fromQuery !== activeProjectRef.current && blockedByPendingCanvasReviewRef.current()) {
      navigate({ pathname: location.pathname, search: canvasLocationSearch(new URLSearchParams(location.search), activeProjectRef.current) },
        { replace: true, state: location.state });
      return;
    }
    if (fromQuery) setCurrentId(fromQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, location.pathname, location.state, navigate]);
  useEffect(() => {
    if (!currentId) return;
    const currentSearch = new URLSearchParams(location.search);
    if (readCanvasIdFromSearch(currentSearch) === currentId) return;
    navigate(
      {
        pathname: location.pathname,
        search: canvasLocationSearch(currentSearch, currentId),
      },
      { replace: true, state: location.state },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);
  const prevProjectIdRef = useRef(currentId);
  useEffect(() => {
    const prev = prevProjectIdRef.current;
    prevProjectIdRef.current = currentId;
    if (!prev || prev === currentId) return;
    onProjectSwitchRef.current();
  }, [currentId]);
}
