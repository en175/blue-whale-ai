import { apiRequest } from './http';
import { newIdempotencyKey } from './idempotencyKey';

export interface SceneCardInfo {
  scene_card_id: number;
  version: number;
  title: string;
  content_markdown: string;
}

export interface GenerationPreset {
  version: number;
  parameters: Record<string, unknown>;
  reference_mode: string;
  reference_assets: unknown[];
  capability_snapshot_version: Record<string, unknown>;
}

export interface SceneCardPresetData {
  scene_card: SceneCardInfo;
  preset: GenerationPreset;
}

export function fetchSceneCardPreset(
  projectId: string,
  sceneCardId: number | string,
): Promise<SceneCardPresetData> {
  return apiRequest<SceneCardPresetData>(
    `/api/projects/${encodeURIComponent(projectId)}/scene-cards/${sceneCardId}/generation-preset`,
  );
}

export interface SceneCardGenerateData {
  scene_card_id: number;
  generation_job_id: number;
  record_id: number;
  preset_version: number;
}

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

export async function deleteSceneCard(sceneCardId: number | string): Promise<void> {
  const path = `/api/scene-cards/${sceneCardId}`;
  const headers: Record<string, string> = {};

  let etag = 'missing';
  try {
    const res = await fetch(path, { headers });
    const e = res.headers.get('ETag');
    if (res.ok && e) etag = e;
  } catch {
  }

  const res = await fetch(path, {
    method: 'DELETE',
    headers: { ...headers, 'If-Match': etag, 'Idempotency-Key': newIdempotencyKey() },
  });
  if (!res.ok) {
    throw new Error(res.status === 412 ? '场景卡版本冲突，请刷新后重试' : `删除场景卡失败（${res.status}）`);
  }
}
