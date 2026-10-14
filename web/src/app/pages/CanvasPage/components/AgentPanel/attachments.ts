import { fileToAssetType } from '@/utils/upload';

export type AttachmentPlan =
  | { ok: true; mediaType: 'image' | 'video' }
  | { ok: false; error: string };

export type SidebarCanvasUpload = {
  asset_id: string;
  url: string;
};

export type ComposerAttachmentPreview = {
  url: string;
  label: string;
  mediaType: 'image' | 'video';
};

export function composerAttachmentPreview(item: {
  name: string;
  mediaType: 'image' | 'video';
  url?: string;
}): ComposerAttachmentPreview | undefined {
  if (!item.url) return undefined;
  return { url: item.url, label: item.name, mediaType: item.mediaType };
}

export function createAttachmentPreviewUrl(file: File): string | undefined {
  const detected = fileToAssetType(file);
  if (detected !== 'image' && detected !== 'video') return undefined;
  return URL.createObjectURL(file);
}

export function revokeAttachmentPreviewUrl(url: string | undefined): void {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
}

export function planAttachment(file: File, projectId: string | undefined): AttachmentPlan {
  const detected = fileToAssetType(file);
  if (detected !== 'image' && detected !== 'video') {
    return { ok: false, error: '只支持图片或视频' };
  }
  if (!projectId) {
    return { ok: false, error: '当前没有项目，无法上传素材' };
  }
  return { ok: true, mediaType: detected };
}

export async function commitSidebarAttachment(
  file: File,
  projectId: string | undefined,
  placeOnCanvasAndUpload: (file: File) => Promise<SidebarCanvasUpload>,
): Promise<
  | { ok: true; mediaType: 'image' | 'video'; uploaded: SidebarCanvasUpload }
  | { ok: false; error: string }
> {
  const plan = planAttachment(file, projectId);
  if (plan.ok === false) return plan;
  try {
    const uploaded = await placeOnCanvasAndUpload(file);
    return { ok: true, mediaType: plan.mediaType, uploaded };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '上传失败' };
  }
}
