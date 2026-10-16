import { useRef } from 'react';

type VideoEnhanceRequest = { projectId: string | null; loadEpoch: object };

export function useCanvasJobFlight() {
  const videoEnhanceInFlightRef = useRef(new Map<string, Set<VideoEnhanceRequest>>());
  const audioMixInFlightRef = useRef(false);
  const audioVideoMuxInFlightRef = useRef(false);
  const audioMixSubmitCardRef = useRef<{ projectId: string; payload: string; nodeId: string; accepted: boolean } | null>(null);
  const sceneSplitSendingRef = useRef(false);
  const smartMattingSendingRef = useRef(false);
  const isVideoEnhanceCardInFlight = (
    nodeId: string,
    activeProjectRef: { current: string | null },
    docLoadEpochRef: { current: object },
  ) =>
    [...(videoEnhanceInFlightRef.current.get(nodeId) ?? [])].some((request) =>
      request.projectId === activeProjectRef.current && request.loadEpoch === docLoadEpochRef.current);
  return {
    videoEnhanceInFlightRef,
    audioMixInFlightRef,
    audioVideoMuxInFlightRef,
    audioMixSubmitCardRef,
    sceneSplitSendingRef,
    smartMattingSendingRef,
    isVideoEnhanceCardInFlight,
  };
}
