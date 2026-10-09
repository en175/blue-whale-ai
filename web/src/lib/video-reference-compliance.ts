export const VIDEO_REFERENCE_NOT_APPROVED_MESSAGE = '该素材未审核通过，不能用于视频生成';

export function isUnapprovedVideoMaterialStatus(status: unknown): boolean {
  return status === 'Failed';
}

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

export function videoReferenceNotApprovedReason(
  status: unknown,
  complianceFailed?: boolean,
): string | null {
  if (complianceFailed === true || isUnapprovedVideoMaterialStatus(status)) {
    return VIDEO_REFERENCE_NOT_APPROVED_MESSAGE;
  }
  return null;
}
