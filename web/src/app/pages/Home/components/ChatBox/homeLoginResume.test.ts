import { describe, expect, it } from 'vitest';
import type { SkillRecord } from '@/app/api/skills';
import { resolveHomeLoginResume, type HomePendingAction } from './homeLoginResume';

const skill: SkillRecord = {
  creative_skill_id: 'skill-1',
  name: '海报生成',
  description: null,
  cover_url: 'https://example.com/cover.png',
  source: null,
  asset_domain: 'official',
};

describe('resolveHomeLoginResume', () => {
  it('没有 pending 时不续接', () => {
    expect(resolveHomeLoginResume(null, true)).toEqual({ action: 'none' });
    expect(resolveHomeLoginResume(null, false)).toEqual({ action: 'none' });
  });

  it('登录成功后打开技能弹窗', () => {
    expect(resolveHomeLoginResume({ kind: 'open-skill' }, true)).toEqual({ action: 'open-skill' });
  });

  it('放弃登录后不打开技能弹窗', () => {
    expect(resolveHomeLoginResume({ kind: 'open-skill' }, false)).toEqual({ action: 'none' });
  });

  it('登录成功后武装「直接使用」的技能', () => {
    const pending: HomePendingAction = { kind: 'use-skill', skill };
    expect(resolveHomeLoginResume(pending, true)).toEqual({ action: 'use-skill', skill });
  });

  it('放弃登录后不武装技能', () => {
    expect(resolveHomeLoginResume({ kind: 'use-skill', skill }, false)).toEqual({ action: 'none' });
  });

  it('登录成功后续接原发送', () => {
    expect(resolveHomeLoginResume({ kind: 'send', text: '一只猫' }, true)).toEqual({
      action: 'send',
      text: '一只猫',
    });
  });

  it('放弃登录后把发送稿回填输入框', () => {
    expect(resolveHomeLoginResume({ kind: 'send', text: '一只猫' }, false)).toEqual({
      action: 'restore-text',
      text: '一只猫',
    });
  });
});
