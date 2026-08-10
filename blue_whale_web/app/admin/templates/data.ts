/**
 * 模板管理数据层（IK764F + IK7JVE）：对接 /api/admin/templates*（withAdminUser 保护）。
 */
import { putWithProgress } from "@/lib/assets";

import { adminRequest } from "../_lib/admin-api";

export type AdminTemplateImage = {
  id: string;
  image_url: string;
  sort_order: number;
};

export type AdminTemplateCard = {
  id: string;
  tag_code: string;
  title: string;
  content: string | null;
  video_url: string | null;
  layout: string;
  sort_order: number;
  images: AdminTemplateImage[];
};

export type AdminTag = {
  tag_code: string;
  label: string;
};

/** 表单数据：images 顺序即展示顺序；带 id 的为已有图片。 */
export type TemplateFormData = {
  title: string;
  tag_code: string;
  layout: string;
  sort_order: number;
  video_url: string;
  content: string;
  images: Array<{ id?: string; image_url: string }>;
};

export const LAYOUT_OPTIONS = [
  { value: "wide", label: "横版视频卡" },
  { value: "portrait", label: "竖版卡" },
  { value: "social", label: "社媒小卡（9:16）" },
  { value: "image", label: "图片卡" },
];

export function layoutLabel(layout: string): string {
  return LAYOUT_OPTIONS.find((o) => o.value === layout)?.label ?? layout;
}

export async function getTemplates(
  tagCode?: string,
): Promise<AdminTemplateCard[]> {
  const qs = tagCode ? `?tagCode=${encodeURIComponent(tagCode)}` : "";
  const { data } = await adminRequest<AdminTemplateCard[]>(
    `/api/admin/templates${qs}`,
  );
  return data;
}

export async function createTemplate(form: TemplateFormData): Promise<void> {
  await adminRequest<{ id: string }>("/api/admin/templates", {
    method: "POST",
    body: JSON.stringify(form),
  });
}

export async function updateTemplate(
  id: string,
  form: TemplateFormData,
): Promise<void> {
  await adminRequest<{ id: string }>(`/api/admin/templates/${id}`, {
    method: "PUT",
    body: JSON.stringify(form),
  });
}

export async function deleteTemplate(id: string): Promise<void> {
  await adminRequest<{ id: string }>(`/api/admin/templates/${id}`, {
    method: "DELETE",
  });
}

export async function moveTemplate(
  id: string,
  direction: "up" | "down",
): Promise<void> {
  await adminRequest<{ id: string }>(`/api/admin/templates/${id}/move`, {
    method: "POST",
    body: JSON.stringify({ direction }),
  });
}

export async function moveTemplateImage(
  imageId: string,
  direction: "up" | "down",
): Promise<void> {
  await adminRequest<{ id: string }>(
    `/api/admin/template-images/${imageId}/move`,
    {
      method: "POST",
      body: JSON.stringify({ direction }),
    },
  );
}

export async function getAdminTags(): Promise<AdminTag[]> {
  const { data } = await adminRequest<AdminTag[]>("/api/admin/template-tags");
  return data;
}

export async function renameTag(tagCode: string, label: string): Promise<void> {
  await adminRequest<{ tag_code: string }>("/api/admin/template-tags", {
    method: "PUT",
    body: JSON.stringify({ tag_code: tagCode, label }),
  });
}

// ---- 模板媒体上传（IK7JVE）：presign → XHR 直传 TOS → complete ----

export type TemplatePresignResult = {
  storage_key: string;
  upload_url: string;
  headers: Record<string, string>;
  expires_in: number;
};

/** presign：管理员鉴权，签发 TOS PUT URL（对象 key 前缀 admin/templates/）。 */
export async function presignTemplateUpload(input: {
  type: "image" | "video";
  mime: string;
  size: number;
}): Promise<TemplatePresignResult> {
  const { data } = await adminRequest<TemplatePresignResult>(
    "/api/admin/templates/uploads/presign",
    { method: "POST", body: JSON.stringify(input) },
  );
  return data;
}

/** complete：HEAD 校验 + public-read + 审计，返回公网 URL。 */
export async function completeTemplateUpload(input: {
  type: "image" | "video";
  mime: string;
  size: number;
  storage_key: string;
}): Promise<{ url: string }> {
  const { data } = await adminRequest<{ url: string }>(
    "/api/admin/templates/uploads/complete",
    { method: "POST", body: JSON.stringify(input) },
  );
  return data;
}

/** 声明 MIME 兜底：浏览器 type 为空时按扩展名推导（模板仅图片/视频）。 */
function templateUploadMime(file: File, kind: "image" | "video"): string {
  if (file.type.trim()) return file.type;
  if (kind === "video") return "video/mp4";
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "image/jpeg"; // jpg/jpeg
}

/** 模板媒体上传（presign → XHR 直传 TOS → complete），成功返回公网 URL（复用画布 putWithProgress）。 */
export async function uploadTemplateMedia(
  file: File,
  kind: "image" | "video",
  onProgress?: (pct: number) => void,
): Promise<string> {
  const presigned = await presignTemplateUpload({
    type: kind,
    mime: templateUploadMime(file, kind),
    size: file.size,
  });
  if (onProgress) {
    await putWithProgress(
      presigned.upload_url,
      presigned.headers,
      file,
      onProgress,
    );
  } else {
    const putResp = await fetch(presigned.upload_url, {
      method: "PUT",
      headers: presigned.headers,
      body: file,
    });
    if (!putResp.ok) throw new Error(`上传失败: ${putResp.status}`);
  }
  const completed = await completeTemplateUpload({
    type: kind,
    mime: templateUploadMime(file, kind),
    size: file.size,
    storage_key: presigned.storage_key,
  });
  return completed.url;
}
