// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { planAttachment } from './attachments';

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
