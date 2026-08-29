import { describe, expect, it } from 'vitest';
import { isRegisterPasswordValid } from './password';

describe('isRegisterPasswordValid', () => {
  it.each([
    ['7 个字符', '1234567', false],
    ['8 个字符', '12345678', true],
    ['9 个字符', '123456789', true],
    ['20 个字符', '12345678901234567890', true],
    ['21 个字符', '123456789012345678901', false],
  ])('仅接受 8-20 个字符：%s', (_scenario, password, expected) => {
    expect(isRegisterPasswordValid(password)).toBe(expected);
  });
});
