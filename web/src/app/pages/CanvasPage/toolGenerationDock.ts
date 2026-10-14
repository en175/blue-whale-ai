import type { ReactNode } from 'react';
import type { ToolSessionHandle } from './toolSessionRuntime';
import type { ToolSessionDeps } from './toolSessionCoordinator';

export type ToolDockEntry = { sourceId: string } | { nodeId: string };
export interface ToolDockPatch<Request> {
  nodeId: string;
  value: Request;
}
interface ToolDockResources<Request> {
  createDraft(sourceId: string): string | undefined;
  getDeps(): ToolSessionDeps;
  updateDraft?(input: ToolDockPatch<Request>): void;
  render?(): ReactNode;
  subscribe(listener: () => void): () => void;
  getVersion(): number;
}

export function createToolGenerationDock<State, Request>(handle: ToolSessionHandle<State, string, Request>, resources: ToolDockResources<Request>) {
  return {
    tool: true as const,
    subscribe: resources.subscribe,
    getVersion: resources.getVersion,
    view() {
      const snapshot = handle.getSnapshot();
      return { ...snapshot, visible: snapshot.visible === true } as const;
    },
    open(input: ToolDockEntry) {
      const nodeId = 'sourceId' in input ? resources.createDraft(input.sourceId) : input.nodeId;
      return nodeId ? handle.open(nodeId, resources.getDeps()) : false;
    },
    hide(_next: string) { handle.close(); },
    close: handle.close,
    updateDraft(input: ToolDockPatch<Request>) { resources.updateDraft?.(input); },
    submit: (request: Request) => handle.send(request),
    render: () => resources.render?.(),
  };
}
