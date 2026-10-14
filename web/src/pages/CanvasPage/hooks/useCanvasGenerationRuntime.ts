import { useEffect, useMemo, useRef } from 'react';
import { createImageToolsTask } from '../generationRuntime/imageTools';
import { type GenerationRuntime, type GenerationRuntimeHost } from '../generationRuntime/runtime';

export function useCanvasGenerationRuntime() {
  const locallyRemovedGenerationNodesRef = useRef<Set<string>>(new Set());
  const settledExtractNodesRef = useRef<Set<string>>(new Set());
  const activeJobByNodeRef = useRef<Map<string, string>>(new Map());
  const generationRuntimeHostRef = useRef<GenerationRuntimeHost | null>(null);
  const generationRuntimeRef = useRef<GenerationRuntime | null>(null);
  const imageToolsAcceptanceRef = useRef(new Map<string, { resolve: (jobId: string) => void; reject: (e: unknown) => void }>());
  const imageToolsTask = useMemo(() => createImageToolsTask((nodeId, settled) => {
    const pending = imageToolsAcceptanceRef.current.get(nodeId);
    if (!pending) return;
    imageToolsAcceptanceRef.current.delete(nodeId);
    if ('jobId' in settled) pending.resolve(settled.jobId);
    else pending.reject(settled.error);
  }), []);
  useEffect(() => {
    const activeJobs = activeJobByNodeRef.current;
    const runtimeRef = generationRuntimeRef;
    return () => {
      activeJobs.clear();
      runtimeRef.current?.reset();
    };
  }, []);
  return {
    locallyRemovedGenerationNodesRef,
    settledExtractNodesRef,
    activeJobByNodeRef,
    generationRuntimeHostRef,
    generationRuntimeRef,
    imageToolsAcceptanceRef,
    imageToolsTask,
  };
}
