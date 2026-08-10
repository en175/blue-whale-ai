/**
 * 模板管理数据层（IK764F）：对接 /api/admin/templates*（withAdminUser 保护）。
 */
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
