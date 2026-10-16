import { useRef, useState } from 'react';
import { createCanvasToolSessions, useCanvasToolSessionEffects, type CanvasToolHosts, type CanvasToolView } from '../tool-runtime/canvasToolSessions';
import { type ToolSessionDeps } from '../tool-runtime/toolSessionCoordinator';
import type { CanvasHistoryApi } from './useCanvasHistory';

export function useCanvasToolWorkspace(currentId: string) {
  const toolHostsRef = useRef<Partial<CanvasToolHosts>>({});
  const toolViewRef = useRef<CanvasToolView | null>(null);
  const toolDepsRef = useRef<ToolSessionDeps | null>(null);
  const [toolSessions] = useState(() => createCanvasToolSessions(
    () => toolHostsRef.current,
    () => toolViewRef.current!,
    () => toolDepsRef.current!,
  ));
  const toolRuntime = toolSessions.runtime;
  useCanvasToolSessionEffects(toolSessions);
  toolRuntime.setProject(currentId);
  const eraseHistoryRef = useRef({
    active: false,
    undo: () => {},
    redo: () => {},
  });
  eraseHistoryRef.current = toolSessions.eraseHistory();
  const historyRef = useRef<CanvasHistoryApi | null>(null);
  const withHistoryBatch = (fn: () => void) => {
    historyRef.current?.beginBatch();
    try {
      fn();
    } finally {
      historyRef.current?.endBatch();
    }
  };
  return {
    toolHostsRef,
    toolViewRef,
    toolDepsRef,
    toolSessions,
    toolRuntime,
    eraseHistoryRef,
    historyRef,
    withHistoryBatch,
  };
}
