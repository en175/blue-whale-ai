import { fileToAssetType } from '@/utils/upload';

/**
 * 选中一个文件后「能不能带上」的判定（IKAL46）。
 *
 * 抽成纯函数是因为这里踩过一次：`projectId` 缺席时旧代码照样上传，素材落进 `project_id=0`，
 * 而 Agent 复核归属用的是**会话所在项目**——两者对不上，`findAccessible` 返回 null，识别一路
 * 失败成「资源不存在」。更糟的是项目 0 连 Agent 的请求头校验都过不了（要求 `[1-9][0-9]*`），
 * 落进去的素材**结构上永远读不到**。所以没有项目时必须当场失败，而不是传进一个死地方。
 */
export type AttachmentPlan =
  | { ok: true; mediaType: 'image' | 'video' }
  | { ok: false; error: string };

/** 侧边栏上传落画布后需要的最小结果：会话附件只认 asset_id，预览靠 url。 */
export type SidebarCanvasUpload = {
  asset_id: string;
  url: string;
};

export function planAttachment(file: File, projectId: string | undefined): AttachmentPlan {
  // 类型按真实 MIME 判定，不按用户点的是哪个菜单项。
  const detected = fileToAssetType(file);
  if (detected !== 'image' && detected !== 'video') {
    return { ok: false, error: '只支持图片或视频' };
  }
  if (!projectId) {
    return { ok: false, error: '当前没有项目，无法上传素材' };
  }
  return { ok: true, mediaType: detected };
}

/**
 * 侧边栏「+」选中文件后的提交契约（IKBA6C）。
 *
 * 能带上的文件必须走 `placeOnCanvasAndUpload`：先在画布落媒体节点（本地预览立即可见），
 * 再完成同一份三步上传。只登记会话附件、不落画布，就是这次缺陷本身。
 * 判定失败则根本不碰画布。
 */
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
