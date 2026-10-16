import type { Node } from '@xyflow/react';
import { isApiError } from '@/shared/api/http';
import { readAssetId } from '../media/mediaRefs';

export interface ProjectCheckHost {
  getProjectId(): string | null;
  warn(message: string): void;
}

export interface SourceCaptureHost extends ProjectCheckHost {
  getSourceNode(nodeId: string): Node | undefined;
}

export function requireProjectId(host: ProjectCheckHost, missingProjectMessage: string): string | null {
  const projectId = host.getProjectId();
  if (!projectId) { host.warn(missingProjectMessage); return null; }
  return projectId;
}

export interface CapturedSourceAsset { node: Node; sourceAssetId: string }
export function captureSourceAsset(host: SourceCaptureHost, nodeId: string, missingAssetMessage: string): CapturedSourceAsset | null {
  const node = host.getSourceNode(nodeId);
  const sourceAssetId = readAssetId(node?.data ?? {});
  if (!node || !sourceAssetId) { host.warn(missingAssetMessage); return null; }
  return { node, sourceAssetId };
}

export function cloneSourceNode(node: Node): Node {
  return { ...node, position: { ...node.position }, data: { ...node.data } };
}

export interface CapturedMediaSource { projectId: string; source: Node; sourceAssetId: string }
export function captureMediaSource(
  host: SourceCaptureHost,
  nodeId: string,
  missingAssetMessage: string,
  missingProjectMessage: string,
): CapturedMediaSource | null {
  const asset = captureSourceAsset(host, nodeId, missingAssetMessage);
  if (!asset) return null;
  const projectId = requireProjectId(host, missingProjectMessage);
  if (!projectId) return null;
  return { projectId, source: cloneSourceNode(asset.node), sourceAssetId: asset.sourceAssetId };
}

export interface PanelSourceCaptureHost extends ProjectCheckHost {
  getNode(nodeId: string): Node | undefined;
}

export function capturePanelIdentity<Identity extends { sourceAssetId?: string }>(
  host: PanelSourceCaptureHost,
  nodeId: string,
  identityKey: string,
  toolLabel: string,
): { projectId: string; identity: Identity & { sourceAssetId: string } } | null {
  const projectId = requireProjectId(host, `未选中项目，无法发起${toolLabel}`);
  if (!projectId) return null;
  const identity = host.getNode(nodeId)?.data[identityKey] as Identity | undefined;
  const { sourceAssetId } = identity ?? {};
  if (!identity || !sourceAssetId) { host.warn(`源素材身份缺失，无法发起${toolLabel}`); return null; }
  return { projectId, identity: { ...identity, sourceAssetId } };
}

export function apiErrorMessage(error: unknown, fallback: string, ...knownErrorTypes: (new (...args: never[]) => Error)[]): string {
  if (isApiError(error)) return error.message;
  for (const ErrorKind of knownErrorTypes) if (error instanceof ErrorKind) return error.message;
  return fallback;
}

export function isSilentAuthError(error: unknown): boolean {
  return isApiError(error) && error.status === 401;
}
