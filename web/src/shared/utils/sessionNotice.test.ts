import { describe, expect, it } from 'vitest';
import {
  loginPromptFor,
  SESSION_EVICTED_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  shouldDropForeignDrafts,
} from './sessionNotice';

describe('登录失效提示', () => {
  it('被挤出和过期使用各自的提示', () => {
    expect(loginPromptFor('session_evicted')).toBe(SESSION_EVICTED_MESSAGE);
    expect(loginPromptFor('session_expired')).toBe(SESSION_EXPIRED_MESSAGE);
    expect(loginPromptFor(undefined)).toBe(SESSION_EXPIRED_MESSAGE);
  });

  it('只有换成另一个账号才丢掉未提交内容', () => {
    expect(shouldDropForeignDrafts(1, 2)).toBe(true);
    expect(shouldDropForeignDrafts(1, 1)).toBe(false);
    expect(shouldDropForeignDrafts(null, 1)).toBe(false);
    expect(shouldDropForeignDrafts(1, null)).toBe(false);
  });
});
