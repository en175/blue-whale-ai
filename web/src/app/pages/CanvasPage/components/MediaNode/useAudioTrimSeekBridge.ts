import { useRef, useCallback } from 'react';
import type { AudioPlayerHandle } from './AudioPlayer';

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
