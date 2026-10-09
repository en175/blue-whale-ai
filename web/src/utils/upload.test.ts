// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { fileToAssetType, uploadAssetFile } from './upload';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function envelope(body: unknown) {
  return new Response(JSON.stringify({ code: 200, data: body }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubUploadFlow() {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(envelope({ dedup: false }))
    .mockResolvedValueOnce(
      envelope({
        storage_key: 'uploads/7/image/a.png',
        upload_url: 'https://tos.example.test/put?sig=secret',
        headers: { 'Content-Type': 'image/png' },
        expires_in: 600,
      }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 200 }))
    .mockResolvedValueOnce(
      envelope({
        asset_id: '123',
        status: 'ready',
        type: 'image',
        url: 'https://cdn.example.test/a.png',
        width: 10,
        height: 10,
        duration: null,
        mime: 'image/png',
        size: 4,
        material_id: null,
        material_status: null,
      }),
    );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const pngBytes = () => {
  const head = new Uint8Array(32);
  head.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return head.slice().buffer as ArrayBuffer;
};

describe('uploadAssetFile', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => 'blob:stub',
      revokeObjectURL: () => {},
    });
    vi.stubGlobal(
      'Image',
      class {
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onerror?.());
        }
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(toast.error).mockClear();
  });

  it('runs dedup → presign → PUT → complete and echoes the presigned identity back (IKAL46/IKCNLS)', async () => {
    const fetchMock = stubUploadFlow();
    const file = new File([pngBytes()], '海边人像.png', { type: 'image/png' });

    await expect(uploadAssetFile(file, { projectId: 'project-9' })).resolves.toMatchObject({
      asset_id: '123',
      url: 'https://cdn.example.test/a.png',
      material_id: null,
      material_status: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const dedupBody = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(dedupBody).toMatchObject({ type: 'image', mime: 'image/png', size: 32, project_id: 'project-9' });
    expect(dedupBody.md5).toMatch(/^[a-f0-9]{32}$/);
    const completeBody = JSON.parse(String((fetchMock.mock.calls[3] as [string, RequestInit])[1].body));
    expect(completeBody).toMatchObject({
      storage_key: 'uploads/7/image/a.png',
      name: '海边人像.png',
      type: 'image',
      mime: 'image/png',
      size: 32,
      project_id: 'project-9',
    });
    expect(completeBody.md5).toMatch(/^[a-f0-9]{32}$/);
  });

  it('reuses the existing asset on dedup hit and skips presign → PUT → complete (IKCNLS)', async () => {
    const asset = {
      asset_id: '526',
      status: 'ready',
      type: 'image',
      url: 'https://cdn.example.test/dup.png',
      width: 854,
      height: 480,
      duration: null,
      mime: 'image/png',
      size: 4,
      material_id: 'asset-20260820153209-6c9z8',
      material_status: 'Active',
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope({ dedup: true, asset }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File([pngBytes()], '同一张图.png', { type: 'image/png' });

    await expect(uploadAssetFile(file, { projectId: 'project-9' })).resolves.toMatchObject({
      asset_id: '526',
      url: 'https://cdn.example.test/dup.png',
      material_id: 'asset-20260820153209-6c9z8',
      material_status: 'Active',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the three-step upload when the dedup request fails (IKCNLS fail-open)', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('dedup down'))
      .mockResolvedValueOnce(
        envelope({
          storage_key: 'uploads/7/image/a.png',
          upload_url: 'https://tos.example.test/put?sig=secret',
          headers: { 'Content-Type': 'image/png' },
          expires_in: 600,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        envelope({
          asset_id: '123',
          status: 'ready',
          type: 'image',
          url: 'https://cdn.example.test/a.png',
          width: 10,
          height: 10,
          duration: null,
          mime: 'image/png',
          size: 4,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(uploadAssetFile(new File([pngBytes()], 'a.png', { type: 'image/png' }))).resolves.toMatchObject({
      asset_id: '123',
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('rejects an oversized file before touching the network (IKAL46)', async () => {
    const fetchMock = stubUploadFlow();
    const huge = new File([''], 'huge.mp4', { type: 'video/mp4' });
    Object.defineProperty(huge, 'size', { value: 500 * 1024 * 1024 });

    await expect(uploadAssetFile(huge)).rejects.toThrow(/上限/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an unsupported file type before touching the network', async () => {
    const fetchMock = stubUploadFlow();
    const doc = new File(['x'], 'spec.pdf', { type: 'application/pdf' });

    await expect(uploadAssetFile(doc)).rejects.toThrow(/格式不支持/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws instead of resolving, so a caller can show the reason', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(uploadAssetFile(new File([pngBytes()], 'a.png', { type: 'image/png' }))).rejects.toBeTruthy();
  });

  it('opts.silent: presign business failure does not pop a toast at the http layer (IKI8L4)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(envelope({ dedup: false })).mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 1, msg: '上传服务繁忙，请稍后重试', data: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(
      uploadAssetFile(new File([pngBytes()], '遮罩.png', { type: 'image/png' }), { silent: true }),
    ).rejects.toThrow('上传服务繁忙，请稍后重试');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('opts.silent: complete business failure does not pop a toast at the http layer (IKI8L4)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(envelope({ dedup: false }))
        .mockResolvedValueOnce(
          envelope({
            storage_key: 'uploads/7/image/a.png',
            upload_url: 'https://tos.example.test/put?sig=secret',
            headers: { 'Content-Type': 'image/png' },
            expires_in: 600,
          }),
        )
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ code: 1, msg: '登记资产失败', data: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
    );

    await expect(
      uploadAssetFile(new File([pngBytes()], '遮罩.png', { type: 'image/png' }), { silent: true }),
    ).rejects.toThrow('登记资产失败');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('missing silent: default toast behavior of the upload chain remains unchanged (IKI8L4)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(envelope({ dedup: false })).mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 1, msg: '上传服务繁忙，请稍后重试', data: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(uploadAssetFile(new File([pngBytes()], 'a.png', { type: 'image/png' }))).rejects.toThrow(
      '上传服务繁忙，请稍后重试',
    );
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});

describe('fileToAssetType', () => {
  it('reads the real MIME rather than trusting which button was clicked (IKAL46)', () => {
    expect(fileToAssetType(new File([], 'a.mp4', { type: 'video/mp4' }))).toBe('video');
    expect(fileToAssetType(new File([], 'a.png', { type: 'image/png' }))).toBe('image');
    expect(fileToAssetType(new File([], 'a.pdf', { type: 'application/pdf' }))).toBeNull();
  });
});
