
import { toast } from 'sonner';
import { ApiError } from '@/api/http';
import { handleUnauthorized } from '@/utils/auth';


export type GroupType = 'AIGC' | 'LivenessFace';

export type MaterialAssetType = 'Image' | 'Video' | 'Audio';

export type MaterialAssetStatus = 'Active' | 'Processing' | 'Failed';

interface UpstreamSuccess<T> {
  ResponseMetadata: Record<string, unknown>;
  Result: T;
}

interface UpstreamError {
  ResponseMetadata: Record<string, unknown>;
  ResponseError: {
    Code: string;
    Message: string;
  };
}

export interface MaterialGroup {
  Id: string;
  Name: string;
  GroupType: GroupType;
  Description?: string;
  CreateTime?: string;
  UpdateTime?: string;
}

export interface ListAssetGroupsResult {
  TotalCount: number;
  Items: MaterialGroup[];
  PageNumber: number;
  PageSize: number;
}

export interface MaterialAsset {
  Id: string;
  Name: string;
  URL: string;
  GroupId: string;
  AssetType: MaterialAssetType;
  Status: MaterialAssetStatus;
  Error?: { Code: string; Message: string };
  CreateTime?: string;
  UpdateTime?: string;
}

export interface ListAssetsResult {
  TotalCount: number;
  Items: MaterialAsset[];
  PageNumber: number;
  PageSize: number;
}

export interface CreateAssetGroupParams {
  Name: string;
  Description?: string;
  GroupType: GroupType;
}

export interface ListAssetGroupsParams {
  Filter?: { GroupType?: GroupType };
  PageNumber: number;
  PageSize: number;
}

export interface UpdateAssetGroupParams {
  Id: string;
  Description?: string;
}

export interface DeleteAssetGroupParams {
  Id: string;
}

export interface CreateAssetParams {
  GroupId?: string;
  URL: string;
  Name: string;
  AssetType: MaterialAssetType;
  SourceAssetId?: string;
}

export interface ListAssetsParams {
  Filter?: {
    GroupIds?: string[];
    GroupType?: GroupType;
    Statuses?: MaterialAssetStatus[];
    Name?: string;
  };
  PageNumber: number;
  PageSize: number;
}

export interface GetAssetParams {
  Id: string;
}

export interface VisualValidateSessionResult {
  BytedToken: string;
  H5Link: string;
}

export interface VisualValidateResult {
  GroupId: string;
}


const materialListInflight = new Map<string, Promise<unknown>>();
const MATERIAL_LIST_ACTIONS = new Set(['ListAssetGroups', 'ListAssets']);

async function materialRequest<T>(
  action: string,
  body: unknown,
  opts?: { silent?: boolean },
): Promise<T> {
  if (MATERIAL_LIST_ACTIONS.has(action)) {
    const key = `${action}:${JSON.stringify(body ?? {})}`;
    const existed = materialListInflight.get(key);
    if (existed) return existed as Promise<T>;
    const pending = materialRequestOnce<T>(action, body, opts).finally(() => {
      materialListInflight.delete(key);
    });
    materialListInflight.set(key, pending);
    return pending;
  }
  return materialRequestOnce<T>(action, body, opts);
}

async function materialRequestOnce<T>(
  action: string,
  body: unknown,
  opts?: { silent?: boolean },
): Promise<T> {
  const url = `/api/material/${action}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : {};

  const fail: (status: number, message: string, code: number | string) => never = (
    status,
    message,
    code,
  ) => {
    const err = new ApiError(status, message, code as number);
    if (status === 401) {
      handleUnauthorized();
    } else if (!opts?.silent) {
      toast.error(message);
    }
    throw err;
  };

  if (
    typeof json === 'object' &&
    json !== null &&
    'code' in json &&
    'msg' in json
  ) {
    const err = json as { code: number; msg: string };
    fail(res.status, err.msg, err.code);
  }

  if (
    typeof json === 'object' &&
    json !== null &&
    'ResponseError' in json
  ) {
    const err = (json as UpstreamError).ResponseError;
    fail(res.status, err.Message ?? `素材库错误(${err.Code})`, err.Code);
  }

  if (
    typeof json === 'object' &&
    json !== null &&
    'Result' in json
  ) {
    return (json as UpstreamSuccess<T>).Result;
  }

  if (res.ok && typeof json === 'object' && json !== null) {
    return json as T;
  }

  return fail(res.status, `素材库请求失败（${res.status}）`, res.status);
}


export function createAssetGroup(params: CreateAssetGroupParams, opts?: { silent?: boolean }) {
  return materialRequest<{ Id: string }>('CreateAssetGroup', params, opts);
}

export function listAssetGroups(params: ListAssetGroupsParams) {
  return materialRequest<ListAssetGroupsResult>('ListAssetGroups', params);
}

export function getAssetGroup(id: string) {
  return materialRequest<MaterialGroup>('GetAssetGroup', { Id: id });
}

export function updateAssetGroup(params: UpdateAssetGroupParams) {
  return materialRequest<Record<string, never>>('UpdateAssetGroup', params);
}

export function deleteAssetGroup(id: string, opts?: { silent?: boolean }) {
  return materialRequest<Record<string, never>>('DeleteAssetGroup', { Id: id }, opts);
}


export function createAsset(params: CreateAssetParams, opts?: { silent?: boolean }) {
  return materialRequest<{ Id: string }>('CreateAsset', params, opts);
}

export function listAssets(params: ListAssetsParams) {
  return materialRequest<ListAssetsResult>('ListAssets', params);
}

export function getAsset(id: string, opts?: { silent?: boolean }) {
  return materialRequest<MaterialAsset>('GetAsset', { Id: id }, opts);
}

export function updateAsset(id: string, name: string) {
  return materialRequest<Record<string, never>>('UpdateAsset', { Id: id, Name: name });
}

export function deleteAsset(id: string) {
  return materialRequest<Record<string, never>>('DeleteAsset', { Id: id });
}


export function createVisualValidateSession(
  params?: { Name?: string; ProjectName?: string; CallbackURL?: string },
  opts?: { silent?: boolean },
) {
  return materialRequest<VisualValidateSessionResult>(
    'CreateVisualValidateSession',
    { ProjectName: 'default', ...params },
    opts,
  );
}

export function getVisualValidateResult(bytedToken: string, opts?: { silent?: boolean }) {
  return materialRequest<VisualValidateResult>('GetVisualValidateResult', {
    BytedToken: bytedToken,
  }, opts);
}

export class MaterialAssetFailedError extends Error {
  constructor() {
    super('seedance合规校验失败，不可用于视频生成');
    this.name = 'MaterialAssetFailedError';
  }
}


export async function waitAssetReady(
  id: string,
  maxAttempts = 30,
  intervalMs = 5000,
): Promise<MaterialAsset> {
  for (let i = 0; i < maxAttempts; i++) {
    const asset = await getAsset(id, { silent: true });
    if (asset.Status === 'Active') return asset;
    if (asset.Status === 'Failed') {
      throw new MaterialAssetFailedError();
    }
    if (i < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw new Error('素材合规校验超时，请重试');
}
