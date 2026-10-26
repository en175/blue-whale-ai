import { describe, expect, it } from 'vitest';
import { canSubmitPasswordChange, isNewPasswordLengthValid } from './password';

describe('isNewPasswordLengthValid', () => {
  it.each([
    ['7 个字符', '1234567', false],
    ['8 个字符', '12345678', true],
    ['9 个字符', '123456789', true],
    ['72 个 ASCII 字符（= 72 字节）', '1'.repeat(72), true],
    ['24 个汉字（= 72 字节）', '汉'.repeat(24), true],
    ['25 个汉字（= 75 字节）', '汉'.repeat(25), false],
    ['73 个 ASCII 字符（> 72 字节）', '1'.repeat(73), false],
  ])('★ 至少 8 位、至多 72 **字节**（与后端 hashPassword 同口径）：%s', (_scenario, password, expected) => {
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
