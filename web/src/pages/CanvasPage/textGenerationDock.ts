import type { ReactNode } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { DockSelection } from './generationDockCoordinator';
import type { ImageTextAttachment } from './components/ImageDialog';

export interface TextDockEntry { nodeId: string; intent?: 'nodeClick' }
export interface TextDockPatch { targetNodeId?: string; prompt?: string; modelId?: string }
export interface TextDockSend { targetNodeId?: string; text: string; modelId: string }
export interface TextGenerationDockHost {
  getNodes(): Node[];
  getEdges(): Edge[];
  attachmentsOf(id: string): ImageTextAttachment[];
  beginEdit(): void;
  patchNode(id: string, data: Record<string, unknown>): void;
  render?(): ReactNode;
}

export function createTextGenerationDock(getHost: () => TextGenerationDockHost) {
  let skipNextNodeClick = false;
  let visible = false, boundId: string | null = null, version = 0;
  const listeners = new Set<() => void>();
  const change = (nextVisible: boolean, nextBoundId = boundId) => {
    if (visible === nextVisible && boundId === nextBoundId) return;
    visible = nextVisible; boundId = nextBoundId; version += 1; listeners.forEach(listener => listener());
  };
  let lastBoundId: string | null | undefined, lastNodes: Node[] = [], lastEdges: Edge[] | null = null;
  let attachments: ImageTextAttachment[] | undefined;
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getVersion: () => version,
    view() {
      const host = boundId ? getHost() : null, nodes = host?.getNodes() ?? [], edges = host?.getEdges() ?? [];
      if (lastBoundId !== boundId || lastEdges !== edges || lastNodes.length !== nodes.length || !lastNodes.every((node, index) => node === nodes[index])) attachments = boundId ? host!.attachmentsOf(boundId) : undefined;
      lastBoundId = boundId; lastNodes = nodes; lastEdges = edges;
      const prompt = nodes.find(node => node.id === boundId)?.data.prompt;
      return { visible, boundId, initialText: typeof prompt === 'string' ? prompt : '', attachments } as const;
    },
    canOpen(input: TextDockEntry) {
      if (input.intent === 'nodeClick' && skipNextNodeClick) { skipNextNodeClick = false; return false; }
      return true;
    },
    beforeOpen() { getHost().beginEdit(); },
    open(input: TextDockEntry) { skipNextNodeClick = false; change(true, input.nodeId); },
    writeSelf() { skipNextNodeClick = true; change(false); },
    hide(_next: string) { change(false); }, close() { change(false); },
    selection({ soloId, multiSelect }: DockSelection) { if (visible && boundId && ((soloId && soloId !== boundId) || multiSelect)) change(false); },
    reconcile() { if (boundId && !getHost().getNodes().some(node => node.id === boundId && node.data.textGen === true)) change(false, null); },
    render: () => visible && boundId ? getHost().render?.() : null,
    updateDraft(input: TextDockPatch) {
      const target = input.targetNodeId ?? boundId;
      if (!target) return;
      getHost().patchNode(target, { ...(input.prompt !== undefined ? { prompt: input.prompt } : {}), ...(input.modelId !== undefined ? { draftModelId: input.modelId } : {}) });
    },
    submit(input: TextDockSend) {
      const target = input.targetNodeId ?? boundId;
      if (!target) return;
      const body = [getHost().attachmentsOf(target).map(item => item.text).filter(Boolean).join('\n\n'), input.text].filter(Boolean).join('\n\n');
      getHost().patchNode(target, { text: body, prompt: input.text, draftModelId: input.modelId });
      change(false);
    },
  };
}
