import { useEffect, useRef, useState } from 'react';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/shared/utils/remoteImageCors';

export interface AudioDurationSource {
  key: string;
  src: string;
}

interface AudioDurationEntry {
  src: string;
  dispose: () => void;
  duration?: number;
}

export function useAudioDurations(sources: readonly AudioDurationSource[]): Map<string, number> {
  const [durations, setDurations] = useState<Map<string, number>>(() => new Map());
  const entriesRef = useRef<Map<string, AudioDurationEntry>>(new Map());

  useEffect(() => {
    const sourceByKey = new Map(sources.map(({ key, src }) => [key, src]));
    const removedKeys = new Set<string>();

    for (const [key, entry] of entriesRef.current) {
      const nextSrc = sourceByKey.get(key);
      if (nextSrc === entry.src) continue;
      entry.dispose();
      entriesRef.current.delete(key);
      removedKeys.add(key);
    }

    for (const { key, src } of sources) {
      if (!src || entriesRef.current.has(key)) continue;
      const audio = new Audio();
      const cors = remoteImageCrossOrigin(src);
      if (cors) audio.crossOrigin = cors;
      audio.preload = 'metadata';
      let disposed = false;
      const entry: AudioDurationEntry = {
        src,
        dispose: () => {
          if (disposed) return;
          disposed = true;
          audio.removeEventListener('loadedmetadata', onLoaded);
          audio.removeAttribute('src');
          audio.load();
        },
      };
      const onLoaded = () => {
        if (entriesRef.current.get(key) !== entry || !Number.isFinite(audio.duration)) return;
        entry.duration = audio.duration;
        entry.dispose();
        setDurations((prev) => {
          if (prev.get(key) === entry.duration) return prev;
          const next = new Map(prev);
          next.set(key, entry.duration!);
          return next;
        });
      };
      audio.addEventListener('loadedmetadata', onLoaded, { once: true });
      audio.src = resolveMediaSrc(src);
      entriesRef.current.set(key, entry);
    }

    if (removedKeys.size > 0) {
      setDurations((prev) => {
        if (![...removedKeys].some((key) => prev.has(key))) return prev;
        const next = new Map(prev);
        for (const key of removedKeys) next.delete(key);
        return next;
      });
    }
  }, [sources]);

  useEffect(
    () => () => {
      for (const entry of entriesRef.current.values()) entry.dispose();
      entriesRef.current.clear();
    },
    [],
  );

  return durations;
}
