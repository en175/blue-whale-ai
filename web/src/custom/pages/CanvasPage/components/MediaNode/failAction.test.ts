import { describe, expect, it } from 'vitest';
import { mediaFailAction, type MediaFailFacts } from './failAction';

function facts(overrides: Partial<MediaFailFacts> = {}): MediaFailFacts {
  return { genStatus: 'failed', hasRetryIdentity: true, ...overrides };
}

describe('mediaFailAction（IKR63Z 失败卡动作判定）', () => {
  it('非失败态不给动作', () => {
    expect(mediaFailAction(facts({ genStatus: 'cancelled' }))).toBe('none');
    expect(mediaFailAction(facts({ genStatus: 'generating' }))).toBe('none');
  });

  it('受理不明 1014 只给核对状态，不给重试', () => {
    expect(mediaFailAction(facts({ errorCode: 1014 }))).toBe('checking');
    expect(mediaFailAction(facts({ errorCode: 'submission_unknown' }))).toBe('checking');
    expect(mediaFailAction(facts({ errorCode: 1014, retryable: true }))).toBe('checking');
  });

  it('存储失败与未知原因只显示状态', () => {
    expect(mediaFailAction(facts({ category: 'storage', retryable: false }))).toBe('save-failed');
    expect(mediaFailAction(facts({ category: 'unknown' }))).toBe('none');
  });

  it('明确可重试的临时异常只给一个重试', () => {
    expect(mediaFailAction(facts({ category: 'transient', retryable: true }))).toBe('retry');
  });

  it('重试条件不满足（无原输入身份、成片阶段）不给重试', () => {
    expect(mediaFailAction(facts({ category: 'transient', retryable: true, hasRetryIdentity: false }))).toBe('none');
    expect(mediaFailAction(facts({ category: 'transient', retryable: true, videoStage: 'final' }))).toBe('none');
  });

  it('各分类给对应主动作', () => {
    expect(mediaFailAction(facts({ category: 'content_rejected', retryable: false }))).toBe('edit-content');
    expect(mediaFailAction(facts({ category: 'capability', retryable: false }))).toBe('edit-params');
    expect(mediaFailAction(facts({ category: 'reference', retryable: false }))).toBe('replace-reference');
    expect(mediaFailAction(facts({ category: 'model_unavailable', retryable: false }))).toBe('edit-model');
    expect(mediaFailAction(facts({ category: 'quota', retryable: false }))).toBe('recharge');
    expect(mediaFailAction(facts({ category: 'quote_changed', retryable: false }))).toBe('requote');
  });

  it('审核、参数、素材、模型、充值、变价动作不受成片阶段限制', () => {
    expect(mediaFailAction(facts({ category: 'content_rejected', videoStage: 'final' }))).toBe('edit-content');
    expect(mediaFailAction(facts({ category: 'quota', videoStage: 'final' }))).toBe('recharge');
    expect(mediaFailAction(facts({ category: 'quote_changed', hasRetryIdentity: false }))).toBe('requote');
  });

  it('字段缺失（旧快照、本地创建失败）沿用现有重试行为', () => {
    expect(mediaFailAction(facts())).toBe('legacy-retry');
    expect(mediaFailAction(facts({ retryable: false, category: undefined }))).toBe('legacy-retry');
  });
});
