import { describe, expect, it } from 'vitest';
import {
  VIDEO_REFERENCE_NOT_APPROVED_MESSAGE,
  compliancePatchFromMaterialStatus,
  isUnapprovedVideoMaterialStatus,
  videoReferenceNotApprovedReason,
} from './video-reference-compliance';

describe('compliancePatchFromMaterialStatus', () => {
  it('图片/视频 material_status 为 Active：标合规通过并带回 materialId', () => {
    expect(compliancePatchFromMaterialStatus('image', 'asset-seedance', 'Active')).toEqual({
      materialId: 'asset-seedance',
      compliancePassed: true,
      complianceFailed: false,
    });
    expect(compliancePatchFromMaterialStatus('video', 'asset-seedance', 'Active')).toEqual({
      materialId: 'asset-seedance',
      compliancePassed: true,
      complianceFailed: false,
    });
  });

  it('Active 但没有 material_id：仍标合规通过，不写空 id', () => {
    expect(compliancePatchFromMaterialStatus('image', null, 'Active')).toEqual({
      compliancePassed: true,
      complianceFailed: false,
    });
  });

  it('null / Processing 不当失败：不标合规通过', () => {
    expect(compliancePatchFromMaterialStatus('image', 'asset-seedance', null)).toEqual({
      materialId: 'asset-seedance',
    });
    expect(compliancePatchFromMaterialStatus('image', null, null)).toEqual({});
    expect(compliancePatchFromMaterialStatus('image', 'asset-seedance', 'Processing')).toEqual({
      materialId: 'asset-seedance',
    });
  });

  it('Failed 不标合规通过（角标只认 Active）', () => {
    expect(compliancePatchFromMaterialStatus('image', 'asset-seedance', 'Failed')).toEqual({
      materialId: 'asset-seedance',
    });
  });

  it('音频不参与合规角标', () => {
    expect(compliancePatchFromMaterialStatus('audio', 'asset-seedance', 'Active')).toEqual({});
  });
});

describe('isUnapprovedVideoMaterialStatus', () => {
  it('只把 Failed 当成未通过', () => {
    expect(isUnapprovedVideoMaterialStatus('Failed')).toBe(true);
    expect(isUnapprovedVideoMaterialStatus('Active')).toBe(false);
    expect(isUnapprovedVideoMaterialStatus('Processing')).toBe(false);
    expect(isUnapprovedVideoMaterialStatus(null)).toBe(false);
  });
});

describe('videoReferenceNotApprovedReason', () => {
  it('Failed 或会话内失败角标返回拦截文案', () => {
    expect(videoReferenceNotApprovedReason('Failed')).toBe(VIDEO_REFERENCE_NOT_APPROVED_MESSAGE);
    expect(videoReferenceNotApprovedReason('Active', true)).toBe(VIDEO_REFERENCE_NOT_APPROVED_MESSAGE);
    expect(videoReferenceNotApprovedReason('Active')).toBeNull();
    expect(videoReferenceNotApprovedReason(null)).toBeNull();
  });
});
