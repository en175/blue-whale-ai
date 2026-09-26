import { describe, expect, it, beforeEach } from 'vitest';
import { ApiError } from '@/api/http';
import { useRechargeUiStore } from '@/stores/recharge';
import {
  blockIfCreditsInsufficient,
  isCreditsExhaustedError,
  isCreditsInsufficient,
  openRechargeForCreditsError,
} from './creditsGate';

describe('isCreditsInsufficient', () => {
  it.each([
    [null, false],
    [undefined, false],
    [0, true],
    [-1, true],
    [1, false],
    [500, false],
  ] as const)('credits=%s → %s', (credits, expected) => {
    expect(isCreditsInsufficient(credits)).toBe(expected);
  });
});

describe('blockIfCreditsInsufficient', () => {
  beforeEach(() => {
    useRechargeUiStore.getState().closeRecharge();
  });

  it('拦截 0 余额并打开充值弹框', () => {
    expect(blockIfCreditsInsufficient(0)).toBe(true);
    expect(useRechargeUiStore.getState().open).toBe(true);
  });

  it('余额充足不打开弹框', () => {
    expect(blockIfCreditsInsufficient(500)).toBe(false);
    expect(useRechargeUiStore.getState().open).toBe(false);
  });

  it('未拉取余额不拦截', () => {
    expect(blockIfCreditsInsufficient(null)).toBe(false);
    expect(useRechargeUiStore.getState().open).toBe(false);
  });
});

describe('isCreditsExhaustedError', () => {
  it('识别 402 / payment_required / quota_exhausted', () => {
    expect(isCreditsExhaustedError(new ApiError(402, '余额不足', 'quota_exhausted'))).toBe(true);
    expect(isCreditsExhaustedError(new ApiError(402, '需支付', 'payment_required'))).toBe(true);
    expect(isCreditsExhaustedError(new ApiError(403, '余额不足', 'quota_exhausted'))).toBe(true);
    expect(isCreditsExhaustedError(new ApiError(400, '参数错误', 'bad_request'))).toBe(false);
    expect(isCreditsExhaustedError(new Error('network'))).toBe(false);
  });
});

describe('openRechargeForCreditsError', () => {
  beforeEach(() => {
    useRechargeUiStore.getState().closeRecharge();
  });

  it('余额耗尽错误打开弹框', () => {
    expect(openRechargeForCreditsError(new ApiError(402, '余额不足', 'quota_exhausted'))).toBe(true);
    expect(useRechargeUiStore.getState().open).toBe(true);
  });

  it('其它错误不打开弹框', () => {
    expect(openRechargeForCreditsError(new ApiError(500, '内部错误', 'internal'))).toBe(false);
    expect(useRechargeUiStore.getState().open).toBe(false);
  });
});
