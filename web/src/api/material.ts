/* ============================================
 * 素材库 API（透传上游镜像）
 * - 后端 MaterialController 使用 @BypassTransform()，返回上游原始响应
 * - 响应不是产品 {code, msg, data} 信封，而是上游信封或直接格式
 * - 鉴权走 HttpOnly cookie（浏览器自动携带），不需手动加 token
 *
 * 两类错误：
 *   产品侧（非法 Action/缺登录/未配置）→ 产品信封 {code, msg, data}
 *   上游侧（业务错误）→ 上游信封 {ResponseMetadata, ResponseError} + 上游状态码
 * ============================================ */

import { ApiError } from './http';

/* ---------- 类型定义 ---------- */

/** 素材组类型 */
export type GroupType = 'AIGC' | 'LivenessFace';

/** 素材类型（上游 AssetType） */
export type MaterialAssetType = 'Image' | 'Video' | 'Audio';

/** 素材状态 */
export type MaterialAssetStatus = 'Active' | 'Processing' | 'Failed';

/** 上游信封：成功 */
interface UpstreamSuccess<T> {
  ResponseMetadata: Record<string, unknown>;
  Result: T;
}

/** 上游信封：错误 */
interface UpstreamError {
  ResponseMetadata: Record<string, unknown>;
  ResponseError: {
    Code: string;
    Message: string;
  };
}

/** 素材组 */
export interface MaterialGroup {
  Id: string;
  Name: string;
  GroupType: GroupType;
  Description?: string;
  CreateTime?: string;
  UpdateTime?: string;
}

/** 素材组列表结果 */
export interface ListAssetGroupsResult {
  TotalCount: number;
  Items: MaterialGroup[];
  PageNumber: number;
  PageSize: number;
}

/** 素材 */
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

/** 素材列表结果 */
export interface ListAssetsResult {
  TotalCount: number;
  Items: MaterialAsset[];
  PageNumber: number;
  PageSize: number;
}

/** 创建素材组请求 */
export interface CreateAssetGroupParams {
  Name: string;
  Description?: string;
  GroupType: GroupType;
}

/** 列出素材组请求 */
export interface ListAssetGroupsParams {
  Filter?: { GroupType?: GroupType };
  PageNumber: number;
  PageSize: number;
}

/** 更新素材组请求（仅支持修改 Description，不支持 Name） */
export interface UpdateAssetGroupParams {
  Id: string;
  Description?: string;
}

/** 删除素材组请求 */
export interface DeleteAssetGroupParams {
  Id: string;
}

/** 上传素材请求 */
export interface CreateAssetParams {
  GroupId: string;
  URL: string;
  Name: string;
  AssetType: MaterialAssetType;
}

/** 列出素材请求 */
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

/** 获取素材请求 */
export interface GetAssetParams {
  Id: string;
}

/** 真人认证会话结果（直接格式，无信封） */
export interface VisualValidateSessionResult {
  BytedToken: string;
  H5Link: string;
}

/** 真人认证查询结果（直接格式） */
export interface VisualValidateResult {
  GroupId: string;
}

/* ---------- 底层：素材库专用请求 ---------- */

/**
 * 素材库专用请求：不套产品信封，直接读上游响应。
 * - 成功：HTTP 2xx + Result 字段
 * - 上游错误：HTTP 4xx/5xx + ResponseError
 * - 产品侧错误：HTTP 4xx/5xx + {code, msg, data}
 */
async function materialRequest<T>(
  action: string,
  body: unknown,
): Promise<T> {
  const url = `/api/material/${action}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  // 尝试解析 JSON，解析失败用空对象兜底
  const json: unknown = text ? JSON.parse(text) : {};

  // 1. 产品侧错误检查（非法 Action / 未配置 / 401）
  //    产品侧错误会被 AllExceptionsFilter 包装成 {code, msg, data}
  if (
    typeof json === 'object' &&
    json !== null &&
    'code' in json &&
    'msg' in json
  ) {
    const err = json as { code: number; msg: string };
    throw new ApiError(res.status, err.msg, err.code);
  }

  // 2. 上游信封错误检查
  if (
    typeof json === 'object' &&
    json !== null &&
    'ResponseError' in json
  ) {
    const err = (json as UpstreamError).ResponseError;
    throw new ApiError(
      res.status,
      err.Message ?? `素材库错误(${err.Code})`,
      err.Code,
    );
  }

  // 3. 上游信封成功
  if (
    typeof json === 'object' &&
    json !== null &&
    'Result' in json
  ) {
    return (json as UpstreamSuccess<T>).Result;
  }

  // 4. 直接格式（真人认证会话/查询，无信封）
  if (res.ok && typeof json === 'object' && json !== null) {
    return json as T;
  }

  // 5. 兜底
  throw new ApiError(res.status, `素材库请求失败（${res.status}）`, res.status);
}

/* ---------- 素材组接口 ---------- */

/** 创建素材组 */
export function createAssetGroup(params: CreateAssetGroupParams) {
  return materialRequest<{ Id: string }>('CreateAssetGroup', params);
}

/** 列出素材组 */
export function listAssetGroups(params: ListAssetGroupsParams) {
  return materialRequest<ListAssetGroupsResult>('ListAssetGroups', params);
}

/** 获取素材组详情 */
export function getAssetGroup(id: string) {
  return materialRequest<MaterialGroup>('GetAssetGroup', { Id: id });
}

/** 更新素材组（仅支持修改 Description） */
export function updateAssetGroup(params: UpdateAssetGroupParams) {
  return materialRequest<Record<string, never>>('UpdateAssetGroup', params);
}

/** 删除素材组（同步删除组内全部素材） */
export function deleteAssetGroup(id: string) {
  return materialRequest<Record<string, never>>('DeleteAssetGroup', { Id: id });
}

/* ---------- 素材接口 ---------- */

/** 上传素材（两段式：先通过 Asset 管道拿公网 URL，再调此接口） */
export function createAsset(params: CreateAssetParams) {
  return materialRequest<{ Id: string }>('CreateAsset', params);
}

/** 列出素材 */
export function listAssets(params: ListAssetsParams) {
  return materialRequest<ListAssetsResult>('ListAssets', params);
}

/** 获取素材详情 */
export function getAsset(id: string) {
  return materialRequest<MaterialAsset>('GetAsset', { Id: id });
}

/** 更新素材（仅支持修改 Name） */
export function updateAsset(id: string, name: string) {
  return materialRequest<Record<string, never>>('UpdateAsset', { Id: id, Name: name });
}

/** 删除素材 */
export function deleteAsset(id: string) {
  return materialRequest<Record<string, never>>('DeleteAsset', { Id: id });
}

/* ---------- 真人活体认证 ---------- */

/** 创建真人认证会话（返回 H5Link + BytedToken，直接格式无信封） */
export function createVisualValidateSession(params?: { Name?: string; ProjectName?: string }) {
  return materialRequest<VisualValidateSessionResult>(
    'CreateVisualValidateSession',
    params ?? {},
  );
}

/** 查询真人认证结果（返回 GroupId，直接格式无信封） */
export function getVisualValidateResult(bytedToken: string) {
  return materialRequest<VisualValidateResult>('GetVisualValidateResult', {
    BytedToken: bytedToken,
  });
}

/* ---------- 辅助：等待素材就绪 ---------- */

/**
 * 轮询素材直到 Status === 'Active' 或失败。
 * @param id 素材 ID（Asset- 前缀）
 * @param maxAttempts 最大轮询次数（默认 30 次，约 150 秒）
 * @param intervalMs 轮询间隔（默认 5 秒）
 */
export async function waitAssetReady(
  id: string,
  maxAttempts = 30,
  intervalMs = 5000,
): Promise<MaterialAsset> {
  for (let i = 0; i < maxAttempts; i++) {
    const asset = await getAsset(id);
    if (asset.Status === 'Active') return asset;
    if (asset.Status === 'Failed') {
      throw new ApiError(
        500,
        asset.Error?.Message ?? `素材处理失败(${asset.Error?.Code})`,
        asset.Error?.Code ?? 'AssetFailed',
      );
    }
    // Processing → 等待后继续
    if (i < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw new ApiError(408, '素材处理超时', 'Timeout');
}
