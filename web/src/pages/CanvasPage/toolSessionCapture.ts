import type { Node } from '@xyflow/react';
import { isApiError } from '@/api/http';
import { readAssetId } from './mediaRefs';

/** 来源捕获的最小宿主面（项目校验部分，各工具宿主结构自然满足）。 */
export interface ProjectCheckHost {
  getProjectId(): string | null;
  warn(message: string): void;
}

/** 编辑会话来源捕获的最小宿主面（getSourceNode 口径）。 */
export interface SourceCaptureHost extends ProjectCheckHost {
  getSourceNode(nodeId: string): Node | undefined;
}

/** 项目校验：未选中项目时提示并返回 null。 */
export function requireProjectId(host: ProjectCheckHost, missingProjectMessage: string): string | null {
  const projectId = host.getProjectId();
  if (!projectId) { host.warn(missingProjectMessage); return null; }
  return projectId;
}

/** 来源资产读取与缺失校验（readAssetId 口径）：通过则返回来源节点与归一 assetId。 */
export interface CapturedSourceAsset { node: Node; sourceAssetId: string }
export function captureSourceAsset(host: SourceCaptureHost, nodeId: string, missingAssetMessage: string): CapturedSourceAsset | null {
  const node = host.getSourceNode(nodeId);
  const sourceAssetId = readAssetId(node?.data ?? {});
  if (!node || !sourceAssetId) { host.warn(missingAssetMessage); return null; }
  return { node, sourceAssetId };
}

/** 来源节点隔离拷贝：冻结提交时的位置与数据，后续画布改动不影响提交输入。 */
export function cloneSourceNode(node: Node): Node {
  return { ...node, position: { ...node.position }, data: { ...node.data } };
}

/** 常用组合：资产校验紧接项目校验，返回冻结的来源提交输入；payload 由各工具补充。 */
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

/** 面板会话来源捕获的最小宿主面（getNode + 节点 data 上的 identity 字段）。 */
export interface PanelSourceCaptureHost extends ProjectCheckHost {
  getNode(nodeId: string): Node | undefined;
}

/** 面板会话来源捕获：项目校验 + identity 读取与 sourceAssetId 缺失校验（payload 由各工具构建）。
 *  返回的 identity 保证 sourceAssetId 非空且为隔离浅拷贝，可直接冻结进提交输入。 */
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

/** API 错误消息透传：ApiError（或工具自身抛出的已知错误类型）透传其 message，其余回落到工具文案。 */
export function apiErrorMessage(error: unknown, fallback: string, ...knownErrorTypes: (new (...args: never[]) => Error)[]): string {
  if (isApiError(error)) return error.message;
  for (const ErrorKind of knownErrorTypes) if (error instanceof ErrorKind) return error.message;
  return fallback;
}

/** 401 静默判定：会话提交遇登录失效不弹反馈。 */
export function isSilentAuthError(error: unknown): boolean {
  return isApiError(error) && error.status === 401;
}
