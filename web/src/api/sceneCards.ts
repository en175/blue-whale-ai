/* ============================================
 * scene-cards 接口：场景卡生成预设 / 再生成 / ETag 条件删除
 * 删除为 HTTP 204 无响应体，走原生 fetch（不经 apiRequest JSON 解析）
 * ============================================ */
import { apiRequest } from './http';
import { newIdempotencyKey } from './idempotencyKey';

/** 场景卡信息 */
export interface SceneCardInfo {
  scene_card_id: number;
  /** 场景卡版本（乐观锁） */
  version: number;
  /** 场景标题 */
  title: string;
  /** 场景正文（Markdown） */
  content_markdown: string;
}

/** 生成预设（只读视图） */
export interface GenerationPreset {
  /** 预设版本 */
  version: number;
  /** 生成参数 */
  parameters: Record<string, unknown>;
  /** 参考模式：none/all/keyframe 等 */
  reference_mode: string;
  /** 参考资产列表 */
  reference_assets: unknown[];
  /** 能力快照版本 */
  capability_snapshot_version: Record<string, unknown>;
}

/** GET /api/projects/:id/scene-cards/:sceneCardId/generation-preset 返回 */
export interface SceneCardPresetData {
  scene_card: SceneCardInfo;
  preset: GenerationPreset;
}

/** 获取场景卡生成预设（场景卡编辑器打开时只读视图） */
export function fetchSceneCardPreset(
  projectId: string,
  sceneCardId: number | string,
): Promise<SceneCardPresetData> {
  return apiRequest<SceneCardPresetData>(
    `/api/projects/${encodeURIComponent(projectId)}/scene-cards/${sceneCardId}/generation-preset`,
  );
}

/** 场景卡再生成返回（100406=版本冲突） */
export interface SceneCardGenerateData {
  scene_card_id: number;
  /** 新生成任务ID（可接入轮询） */
  generation_job_id: number;
  record_id: number;
  /** 预设新版本 */
  preset_version: number;
}

/**
 * 场景卡再生成 POST /api/projects/:id/scene-cards/:sceneCardId/generate
 * 请求体由编辑器按 sceneCardRegenerationRequestSchema 构造
 */
export function regenerateSceneCard(
  projectId: string,
  sceneCardId: number | string,
  body: Record<string, unknown>,
): Promise<SceneCardGenerateData> {
  return apiRequest<SceneCardGenerateData>(
    `/api/projects/${encodeURIComponent(projectId)}/scene-cards/${sceneCardId}/generate`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: JSON.stringify(body),
    },
  );
}

/**
 * 删除场景卡：先 GET 读取 ETag，再带 If-Match 条件删除（乐观锁）
 * - 成功 HTTP 204 No Content；版本冲突返回 412 抛错
 * - 读取 ETag 失败时以 "missing" 兜底提交
 */
export async function deleteSceneCard(sceneCardId: number | string): Promise<void> {
  const path = `/api/scene-cards/${sceneCardId}`;
  // 登录态走 HttpOnly 会话 cookie，浏览器自动携带
  const headers: Record<string, string> = {};

  let etag = 'missing';
  try {
    const res = await fetch(path, { headers });
    const e = res.headers.get('ETag');
    if (res.ok && e) etag = e;
  } catch {
    /* 读取 ETag 失败按 missing 提交，由后端版本检查兜底 */
  }

  const res = await fetch(path, {
    method: 'DELETE',
    headers: { ...headers, 'If-Match': etag, 'Idempotency-Key': newIdempotencyKey() },
  });
  if (!res.ok) {
    throw new Error(res.status === 412 ? '场景卡版本冲突，请刷新后重试' : `删除场景卡失败（${res.status}）`);
  }
}
