import { describe, expect, it } from 'vitest';

import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  isPasswordSettable,
  passwordByteLength,
} from './password';

/**
 * 前端口令规则的**唯一权威**。
 *
 * 它必须与后端 `backend/libs/shared/identity/password.ts` 的 `hashPassword` 同口径：
 * 至少 8 位、至多 72 **字节**。两边不一致的后果是「前端放过去、后端拒掉」——
 * 用户看到的是「点确定没反应」，而没有任何一处文案解释为什么。
 */
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
    // 按字符数判的话，24 个汉字（72 字节，刚好卡上限）会被当成「才 24 个字符，很短」，
    // 而它已经到 bcrypt 的截断点了。
    expect(passwordByteLength('汉'.repeat(24))).toBe(72);
    expect(isPasswordSettable('汉'.repeat(24))).toBe(true);
    expect(isPasswordSettable('汉'.repeat(25))).toBe(false);
  });

  it('★ 不做复杂度规则 —— 8 个纯数字也算合规', () => {
    // 这不是漏写。大小写/符号要求把用户推向 Passw0rd! 这类可预测的口令，
    // 收益远不如长度；后端 hashPassword 也是这么定的。
    expect(isPasswordSettable('12345678')).toBe(true);
  });
});

describe('passwordByteLength', () => {
  it('与后端 Buffer.byteLength(..., "utf8") 同口径', () => {
    expect(passwordByteLength('abc')).toBe(3);
    expect(passwordByteLength('汉')).toBe(3);
    expect(passwordByteLength('汉a')).toBe(4);
    expect(passwordByteLength('')).toBe(0);
    // emoji 是 4 字节（代理对）——按 `.length` 数会得到 2，差一半
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
