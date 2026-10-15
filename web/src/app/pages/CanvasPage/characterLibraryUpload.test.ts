import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/http';
import { FileRejectedError } from '@/app/utils/fileSignature';
import { uploadMaterialLibraryFiles } from './characterLibraryUpload';

const { createAsset, uploadAssetFile } = vi.hoisted(() => ({
  createAsset: vi.fn(),
  uploadAssetFile: vi.fn(),
}));

vi.mock('@/app/api/material', () => ({ createAsset }));
vi.mock('@/app/utils/upload', () => ({ uploadAssetFile }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

function imageFile(name = 'face.png') {
  return new File(['x'], name, { type: 'image/png' });
}

function videoFile(name = 'clip.mp4') {
  return new File(['x'], name, { type: 'video/mp4' });
}

describe('uploadMaterialLibraryFiles 角色库本地上传（TC_DG_209/213/302）', () => {
  beforeEach(() => {
    createAsset.mockReset();
    uploadAssetFile.mockReset();
  });

  it('图片/视频入库成功并返回素材 id', async () => {
    uploadAssetFile.mockResolvedValue({ url: 'https://cdn.example/a.png', asset_id: 11 });
    createAsset
      .mockResolvedValueOnce({ Id: 'Asset-1' })
      .mockResolvedValueOnce({ Id: 'Asset-2' });

    const result = await uploadMaterialLibraryFiles([imageFile(), videoFile()], null);

    expect(createAsset).toHaveBeenCalledWith(
      expect.objectContaining({ AssetType: 'Image', SourceAssetId: '11' }),
      { silent: true },
    );
    expect(result).toEqual({ errors: [], createdIds: ['Asset-1', 'Asset-2'] });
  });

  it('非图片视频不入库并给出原因', async () => {
    const result = await uploadMaterialLibraryFiles(
      [new File(['x'], 'voice.mp3', { type: 'audio/mpeg' })],
      null,
    );
    expect(uploadAssetFile).not.toHaveBeenCalled();
    expect(result.errors).toEqual(['voice.mp3：仅支持图片和视频']);
    expect(result.createdIds).toEqual([]);
  });

  it('文件本身不合格保留原句，不改成请重试', async () => {
    uploadAssetFile.mockRejectedValue(new FileRejectedError('clip.mp4 的格式不支持，请用 JPG、PNG、WebP、MP4 或常见音频格式。'));
    const result = await uploadMaterialLibraryFiles([videoFile()], null);
    expect(result.errors).toEqual(['clip.mp4 的格式不支持，请用 JPG、PNG、WebP、MP4 或常见音频格式。']);
  });

  it('API / 网络失败提示请重试且不产生半成品 id', async () => {
    uploadAssetFile.mockResolvedValue({ url: 'https://cdn.example/a.png', asset_id: 11 });
    createAsset.mockRejectedValue(new ApiError(500, '素材服务异常', 500));
    const result = await uploadMaterialLibraryFiles([imageFile()], null);
    expect(result.createdIds).toEqual([]);
    expect(result.errors).toEqual(['素材服务异常，请重试']);
  });
});
