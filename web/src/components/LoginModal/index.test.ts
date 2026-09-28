import { describe, expect, it } from 'vitest';
import { isRegisterPasswordValid } from './password';

describe('isRegisterPasswordValid', () => {
  it.each([
    ['7 个字符', '1234567', false],
    ['8 个字符', '12345678', true],
    ['9 个字符', '123456789', true],
    ['72 个 ASCII 字符（= 72 字节）', '1'.repeat(72), true],
    ['24 个汉字（= 72 字节）', '汉'.repeat(24), true],
    ['25 个汉字（= 75 字节）', '汉'.repeat(25), false],
    ['73 个 ASCII 字符（> 72 字节）', '1'.repeat(73), false],
  ])('★ 至少 8 位、至多 72 **字节**（与后端 hashPassword 同口径）：%s', (_scenario, password, expected) => {
    expect(isRegisterPasswordValid(password)).toBe(expected);
  });
});
