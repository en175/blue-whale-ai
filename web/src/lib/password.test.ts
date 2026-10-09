import { describe, expect, it } from 'vitest';

import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  isPasswordSettable,
  passwordByteLength,
} from './password';

describe('isPasswordSettable', () => {
  it.each([
    ['7 个字符（差一位）', '1'.repeat(7), false],
    ['8 个字符（刚好）', '1'.repeat(8), true],
    [`${PASSWORD_MAX_BYTES} 个 ASCII（= 上限字节数）`, '1'.repeat(72), true],
    [`${PASSWORD_MAX_BYTES + 1} 个 ASCII（超一个字节）`, '1'.repeat(73), false],
  ])('ASCII：%s → %s', (_scenario, password, expected) => {
    expect(isPasswordSettable(password)).toBe(expected);
  });

  it('★ 按**字节**算上限，不按字符数 —— 一个汉字 3 个字节', () => {
    expect(passwordByteLength('汉'.repeat(24))).toBe(72);
    expect(isPasswordSettable('汉'.repeat(24))).toBe(true);
    expect(isPasswordSettable('汉'.repeat(25))).toBe(false);
  });

  it('★ 不做复杂度规则 —— 8 个纯数字也算合规', () => {
    expect(isPasswordSettable('12345678')).toBe(true);
  });
});

describe('passwordByteLength', () => {
  it('与后端 Buffer.byteLength(..., "utf8") 同口径', () => {
    expect(passwordByteLength('abc')).toBe(3);
    expect(passwordByteLength('汉')).toBe(3);
    expect(passwordByteLength('汉a')).toBe(4);
    expect(passwordByteLength('')).toBe(0);
    expect(passwordByteLength('🙂')).toBe(4);
  });
});

describe('常量', () => {
  it('下限与后端一致（8）', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
  });

  it('上限与后端 bcrypt 的 72 字节一致', () => {
    expect(PASSWORD_MAX_BYTES).toBe(72);
  });
});
