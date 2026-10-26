import type { Node } from '@xyflow/react';

function readJobId(data: { jobId?: unknown } | undefined): string | number | undefined {
  const raw = data?.jobId;
  return typeof raw === 'string' || typeof raw === 'number' ? raw : undefined;
}

export function hasGenerationRecordData(data: { jobId?: unknown; draft?: unknown } | undefined): boolean {
  return data?.draft !== true && readJobId(data) !== undefined;
}

export function hasGenerationRecord(node: Node | undefined): boolean {
  if (!node || node.type !== 'mediaNode') return false;
  return hasGenerationRecordData(node.data as { jobId?: unknown; draft?: unknown } | undefined);
}

export function isInPlaceRegenTarget(node: Node | undefined): boolean {
  if (!node || node.type !== 'mediaNode') return false;
  const data = (node.data ?? {}) as Record<string, unknown>;
  if (data.draft === true) return true;
  return hasGenerationRecord(node);
}

export function cancelledTerminalAction(node: Node | undefined): 'to-draft' | 'restore' | 'remove' {
  if (!node || node.type !== 'mediaNode') return 'remove';
  const data = (node.data ?? {}) as Record<string, unknown>;
  if (data.draft === true) return 'to-draft';
  if (hasGenerationRecord(node) && hasSettledMediaSrc(data)) return 'restore';
  return 'remove';
}

function hasSettledMediaSrc(data: Record<string, unknown>): boolean {
  const src = data.src;
  return typeof src === 'string' && src !== '' && !src.startsWith('blob:');
}
