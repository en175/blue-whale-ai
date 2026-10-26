import { describe, expect, it } from 'vitest';
import { formFromConfig, previewIssue, toSaveParams, validateCustomConfigForm, type CustomConfigForm } from './customConfig';
import type { AdminRechargeCustomConfig } from '@/admin/api/adminRechargeCustomConfig';

const CONFIG: AdminRechargeCustomConfig = {
  minCredits: 600,
  maxCredits: 499_995,
  defaultCredits: 600,
  creditsPerYuan: 15,
  stepCredits: 15,
  enabled: true,
  permission: 'all',
  permissionAllowlist: [],
  permissionDeniedHint: '',
  creditsValidMonths: 24,
  version: 3,
  updatedAt: '2026-09-27T10:00:00+08:00',
};

const form = (patch: Partial<CustomConfigForm> = {}): CustomConfigForm => ({
  ...formFromConfig(CONFIG),
  ...patch,
});

describe('customConfig — 表单映射', () => {
  it('接口记录转成字符串草稿，白名单深拷贝（改草稿不会动到缓存里的那份）', () => {
    const source = { ...CONFIG, permissionAllowlist: ['9001'] };
    const draft = formFromConfig(source);

    expect(draft.minCredits).toBe('600');
    expect(draft.creditsValidMonths).toBe('24');
    expect(draft.permissionAllowlist).toEqual(['9001']);
    draft.permissionAllowlist.push('9002');
    expect(source.permissionAllowlist).toEqual(['9001']);
  });

  it('提交整份（camelCase），无权限提示去掉首尾空白', () => {
    expect(toSaveParams(form({ permissionDeniedHint: '  仅限内测  ' }))).toEqual({
      minCredits: 600,
      maxCredits: 499_995,
      defaultCredits: 600,
      creditsPerYuan: 15,
      stepCredits: 15,
      creditsValidMonths: 24,
      enabled: true,
      permission: 'all',
      permissionAllowlist: [],
      permissionDeniedHint: '仅限内测',
    });
  });
});

describe('customConfig — 校验（服务端 validateCustomConfig 的镜像）', () => {
  it('★ 默认口径合法', () => {
    expect(validateCustomConfigForm(form())).toBeNull();
    expect(previewIssue(form())).toBeNull();
  });

  it('★ 空框报「须为 1 以上的整数」，不是拿 0 蒙过去', () => {
    expect(validateCustomConfigForm(form({ minCredits: '' }))).toContain('最低积分须为 1 以上的整数');
  });

  it('★ 最高低于最低、默认落在区间外都要拦', () => {
    expect(validateCustomConfigForm(form({ maxCredits: '300' }))).toBe('最高积分不得低于最低积分');
    expect(validateCustomConfigForm(form({ defaultCredits: '585' }))).toContain(
      '默认积分须落在最低积分与最高积分之间',
    );
  });

  it('★ 上下限与默认值必须能被每元积分数整除（否则价格不是整分）', () => {
    expect(validateCustomConfigForm(form({ creditsPerYuan: '7' }))).toContain('不能被每元积分数 7 整除');
  });

  it('★ 步长对不齐要拦：滑杆推不到最高值时，界面上那句「最高 X」就是假的', () => {
    expect(validateCustomConfigForm(form({ stepCredits: '10' }))).toContain(
      '必须是积分步长 10 的整数倍',
    );
  });

  it('★ 有效期必须是 1–1200 的整数（月）', () => {
    expect(validateCustomConfigForm(form({ creditsValidMonths: '0' }))).toContain(
      '积分有效期须为 1–1200 的整数',
    );
    expect(validateCustomConfigForm(form({ creditsValidMonths: '1201' }))).toContain(
      '积分有效期须为 1–1200 的整数',
    );
  });

  it('★ 无权限提示长度封顶（与服务端 400 同一口径）', () => {
    expect(validateCustomConfigForm(form({ permissionDeniedHint: 'x'.repeat(256) }))).toContain(
      '最长 255 个字符',
    );
    expect(validateCustomConfigForm(form({ permissionDeniedHint: 'x'.repeat(255) }))).toBeNull();
  });

  it('★ 白名单里混进非 userId 要拦：那条规则永远匹配不上，界面上却看着配好了', () => {
    expect(validateCustomConfigForm(form({ permissionAllowlist: ['9001', 'user-2'] }))).toContain(
      '不是合法的 userId',
    );
  });

  it('输入过程中只给一句安静提示，不喷服务端那串长文案', () => {
    expect(previewIssue(form({ maxCredits: '499996' }))).toBe('最高积分不能被每元积分数整除');
    expect(previewIssue(form({ minCredits: '' }))).toBeNull();
  });
});
