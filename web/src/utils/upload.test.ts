// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileToAssetType, uploadAssetFile } from './upload';

function envelope(body: unknown) {
  return new Response(JSON.stringify({ code: 200, data: body }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** dedup（未命中）→ presign → PUT → complete 四段的顺序桩 */
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
      }),
    );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('uploadAssetFile', () => {
  beforeEach(() => {
    // jsdom 不真的加载图片，probeMediaMeta 的 onload/onerror 都不会自己触发。
    // 用一个当场报错的 Image 桩让它确定性地落到「没探到元数据」那一支。
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
  afterEach(() => vi.unstubAllGlobals());

  it('runs dedup → presign → PUT → complete and echoes the presigned identity back (IKAL46/IKCNLS)', async () => {
    const fetchMock = stubUploadFlow();
    const file = new File(['abcd'], '海边人像.png', { type: 'image/png' });

    await expect(uploadAssetFile(file, { projectId: 'project-9' })).resolves.toMatchObject({
      asset_id: '123',
      url: 'https://cdn.example.test/a.png',
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    // dedup 预检须携带 md5 与 project_id，供后端建项目关联
    const dedupBody = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(dedupBody).toMatchObject({ type: 'image', mime: 'image/png', size: 4, project_id: 'project-9' });
    expect(dedupBody.md5).toMatch(/^[a-f0-9]{32}$/);
    // complete 必须回传与 presign 完全一致的 storage_key/type/mime/size，否则后端拒收；
    // 并带上 md5 落库，供下次同内容文件查重。
    const completeBody = JSON.parse(String((fetchMock.mock.calls[3] as [string, RequestInit])[1].body));
    expect(completeBody).toMatchObject({
      storage_key: 'uploads/7/image/a.png',
      type: 'image',
      mime: 'image/png',
      size: 4,
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
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(envelope({ dedup: true, asset }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['abcd'], '同一张图.png', { type: 'image/png' });

    await expect(uploadAssetFile(file, { projectId: 'project-9' })).resolves.toMatchObject({
      asset_id: '526',
      url: 'https://cdn.example.test/dup.png',
    });
    // 命中后只发生一次 dedup 请求，TOS 三步全部跳过
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the three-step upload when the dedup request fails (IKCNLS fail-open)', async () => {
    const fetchMock = vi
      .fn()
      // dedup 网络失败 → 静默降级
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

    await expect(uploadAssetFile(new File(['abcd'], 'a.png', { type: 'image/png' }))).resolves.toMatchObject({
      asset_id: '123',
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('rejects an oversized file before touching the network (IKAL46)', async () => {
    // presign 那侧也会拒，但要等一次网络往返、且回来的是通用错误码，用户看不出是文件太大。
    const fetchMock = stubUploadFlow();
    const huge = new File([''], 'huge.mp4', { type: 'video/mp4' });
    Object.defineProperty(huge, 'size', { value: 500 * 1024 * 1024 });

    await expect(uploadAssetFile(huge)).rejects.toThrow(/上限/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an unsupported file type before touching the network', async () => {
    const fetchMock = stubUploadFlow();
    const doc = new File(['x'], 'spec.pdf', { type: 'application/pdf' });

    await expect(uploadAssetFile(doc)).rejects.toThrow(/不支持的文件类型/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws instead of resolving, so a caller can show the reason', async () => {
    // Agent 面板要把失败原因显示出来：用户刚选完文件，静默失败会让他以为图已经带上了。
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(uploadAssetFile(new File(['abcd'], 'a.png', { type: 'image/png' }))).rejects.toBeTruthy();
  });
});

describe('fileToAssetType', () => {
  it('reads the real MIME rather than trusting which button was clicked (IKAL46)', () => {
    // 在「上传图片」里挑了个视频（某些平台允许）时，真实类型才是对的——asset_ref 的
    // media_type 由它决定，报错也要报得准。
    expect(fileToAssetType(new File([], 'a.mp4', { type: 'video/mp4' }))).toBe('video');
    expect(fileToAssetType(new File([], 'a.png', { type: 'image/png' }))).toBe('image');
    expect(fileToAssetType(new File([], 'a.pdf', { type: 'application/pdf' }))).toBeNull();
  });
});
