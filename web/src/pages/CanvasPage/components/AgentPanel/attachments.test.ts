// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { commitSidebarAttachment, composerAttachmentPreview, planAttachment } from './attachments';

const png = () => new File([''], 'a.png', { type: 'image/png' });

describe('planAttachment', () => {
  it('accepts an image and a video, typed by real MIME rather than by which button was clicked', () => {
    expect(planAttachment(png(), '163')).toEqual({ ok: true, mediaType: 'image' });
    expect(planAttachment(new File([''], 'a.mp4', { type: 'video/mp4' }), '163')).toEqual({
      ok: true,
      mediaType: 'video',
    });
  });

  it('rejects a non-image, non-video file', () => {
    expect(planAttachment(new File([''], 'a.pdf', { type: 'application/pdf' }), '163')).toMatchObject({
      ok: false,
    });
  });

  it('refuses to upload when there is no project — project 0 is unreadable by the Agent (IKAL46)', () => {
    // 这条锁住的是一个真实踩过的缺陷：缺 projectId 时旧代码静默上传，素材落进 project_id=0。
    // Agent 用会话所在项目复核归属，对不上 → 404 → 识别整条失败；且项目 0 连 Agent 的
    // 请求头校验都过不了。宁可当场报错，也不要产出一个永远读不到的素材。
    for (const missing of [undefined, '']) {
      expect(planAttachment(png(), missing)).toEqual({
        ok: false,
        error: '当前没有项目，无法上传素材',
      });
    }
  });
});

describe('commitSidebarAttachment', () => {
  const uploaded = { asset_id: 'asset-1', url: 'https://cdn.example/a.png' };

  it('places a valid file on the canvas instead of uploading only into the session (IKBA6C)', async () => {
    const placeOnCanvasAndUpload = vi.fn(async (file: File) => {
      expect(file.name).toBe('a.png');
      return uploaded;
    });
    await expect(commitSidebarAttachment(png(), '163', placeOnCanvasAndUpload)).resolves.toEqual({
      ok: true,
      mediaType: 'image',
      uploaded,
    });
    expect(placeOnCanvasAndUpload).toHaveBeenCalledTimes(1);
  });

  it('does not touch the canvas when the file is rejected', async () => {
    const placeOnCanvasAndUpload = vi.fn();
    await expect(
      commitSidebarAttachment(new File([''], 'a.pdf', { type: 'application/pdf' }), '163', placeOnCanvasAndUpload),
    ).resolves.toMatchObject({ ok: false, error: '只支持图片或视频' });
    expect(placeOnCanvasAndUpload).not.toHaveBeenCalled();
  });

  it('does not touch the canvas when there is no project', async () => {
    const placeOnCanvasAndUpload = vi.fn();
    await expect(commitSidebarAttachment(png(), undefined, placeOnCanvasAndUpload)).resolves.toEqual({
      ok: false,
      error: '当前没有项目，无法上传素材',
    });
    expect(placeOnCanvasAndUpload).not.toHaveBeenCalled();
  });

  it('surfaces canvas-upload failures without claiming the attachment is ready', async () => {
    const placeOnCanvasAndUpload = vi.fn(async () => {
      throw new Error('画布上传登记失败');
    });
    await expect(commitSidebarAttachment(png(), '163', placeOnCanvasAndUpload)).resolves.toEqual({
      ok: false,
      error: '画布上传登记失败',
    });
  });
});

describe('composerAttachmentPreview', () => {
  it('turns an uploading sidebar image with a local URL into a thumbnail capsule', () => {
    expect(
      composerAttachmentPreview({
        name: 'shot.png',
        mediaType: 'image',
        url: 'blob:https://localhost/preview-1',
      }),
    ).toEqual({
      url: 'blob:https://localhost/preview-1',
      label: 'shot.png',
      mediaType: 'image',
    });
  });

  it('turns a sidebar video with a remote URL into a thumbnail capsule', () => {
    expect(
      composerAttachmentPreview({
        name: 'clip.mp4',
        mediaType: 'video',
        url: 'https://cdn.example/clip.mp4',
      }),
    ).toEqual({
      url: 'https://cdn.example/clip.mp4',
      label: 'clip.mp4',
      mediaType: 'video',
    });
  });

  it('does not invent a thumbnail when the attachment has no URL yet', () => {
    expect(
      composerAttachmentPreview({
        name: 'shot.png',
        mediaType: 'image',
      }),
    ).toBeUndefined();
  });
});
