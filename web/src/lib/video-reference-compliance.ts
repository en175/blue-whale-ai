/** 视频生成采纳参考时的统一拦截文案（IKGK37 / REQ-D-204） */
export const VIDEO_REFERENCE_NOT_APPROVED_MESSAGE = '该素材未审核通过，不能用于视频生成';

/** 素材库 Status / 本地 material_status 是否为合规未通过 */
export function isUnapprovedVideoMaterialStatus(status: unknown): boolean {
  return status === 'Failed';
}

/** 上传/去重响应：只认 material_status === Active 为已过 Seedance 校验；null 不当失败。 */
export function compliancePatchFromMaterialStatus(
  mediaType: string | undefined,
  materialId?: string | null,
  materialStatus?: string | null,
): { materialId?: string; compliancePassed?: boolean; complianceFailed?: boolean } {
  if (mediaType === 'audio') return {};
  const verifiedId = typeof materialId === 'string' && materialId ? materialId : undefined;
  if (materialStatus === 'Active') {
    return {
      ...(verifiedId ? { materialId: verifiedId } : {}),
      compliancePassed: true,
      complianceFailed: false,
    };
  }
  return verifiedId ? { materialId: verifiedId } : {};
}

/** 采纳视频参考时的拒绝原因；通过则返回 null */
export function videoReferenceNotApprovedReason(
  status: unknown,
  complianceFailed?: boolean,
): string | null {
  if (complianceFailed === true || isUnapprovedVideoMaterialStatus(status)) {
    return VIDEO_REFERENCE_NOT_APPROVED_MESSAGE;
  }
  return null;
}
