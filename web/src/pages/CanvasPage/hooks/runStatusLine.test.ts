import { describe, expect, it } from 'vitest';
import { deriveRunStatus } from './runStatusLine';

const base = { activeSince: 1_000_000, now: 1_000_000, activity: null, stalled: false };

describe('deriveRunStatus', () => {
  it('没有进行中的轮次时不显示', () => {
    expect(deriveRunStatus({ ...base, activeSince: null })).toBeNull();
  });

  it('模型还没吐出任何东西时也要显示，这是它存在的全部意义', () => {
    expect(deriveRunStatus(base)).toEqual({ label: '正在思考', seconds: 0, tone: 'working' });
  });

  it('秒数按经过的时间走', () => {
    expect(deriveRunStatus({ ...base, now: 1_014_600 })?.seconds).toBe(14);
  });

  it('有可见节点后换成节点描述', () => {
    expect(deriveRunStatus({ ...base, now: 1_014_000, activity: '正在编排分镜与提示词' })).toEqual({
      label: '正在编排分镜与提示词',
      seconds: 14,
      tone: 'working',
    });
  });

  it('长时间无进展只换语气，绝不隐藏——此时最需要它', () => {
    const status = deriveRunStatus({ ...base, now: 1_090_000, activity: '正在逐个分镜生成画面描述', stalled: true });
    expect(status).toMatchObject({ label: '正在逐个分镜生成画面描述', seconds: 90, tone: 'stalled' });
  });

  it('起点来自服务端时间、浏览器时钟偏慢时，计时器不会倒着走', () => {
    expect(deriveRunStatus({ ...base, now: 999_000 })?.seconds).toBe(0);
  });
});
