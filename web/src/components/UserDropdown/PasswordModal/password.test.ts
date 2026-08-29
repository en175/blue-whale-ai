import { describe, expect, it } from 'vitest';
import { canSubmitPasswordChange, isNewPasswordLengthValid } from './password';

describe('isNewPasswordLengthValid', () => {
  it.each([
    ['7 个字符', '1234567', false],
    ['8 个字符', '12345678', true],
    ['9 个字符', '123456789', true],
    ['20 个字符', '12345678901234567890', true],
    ['21 个字符', '123456789012345678901', false],
  ])('仅接受 8-20 个字符：%s', (_scenario, password, expected) => {
    expect(isNewPasswordLengthValid(password)).toBe(expected);
  });
});

describe('canSubmitPasswordChange', () => {
  const validNew = '12345678';

  it('旧密码、合法新密码且两次输入一致时可提交', () => {
    expect(
      canSubmitPasswordChange({
        oldPassword: 'old-pass',
        newPassword: validNew,
        confirmPassword: validNew,
      }),
    ).toBe(true);
  });

  it('提交不依赖短信验证码', () => {
    expect(
      canSubmitPasswordChange({
        oldPassword: 'old-pass',
        newPassword: validNew,
        confirmPassword: validNew,
      }),
    ).toBe(true);
  });

  it('缺少旧密码或两次新密码不一致时不可提交', () => {
    expect(
      canSubmitPasswordChange({
        oldPassword: '   ',
        newPassword: validNew,
        confirmPassword: validNew,
      }),
    ).toBe(false);
    expect(
      canSubmitPasswordChange({
        oldPassword: 'old-pass',
        newPassword: validNew,
        confirmPassword: '12345679',
      }),
    ).toBe(false);
  });
});
