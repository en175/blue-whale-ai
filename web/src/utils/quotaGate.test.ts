import { describe, expect, it, beforeEach } from 'vitest';
import { ApiError } from '@/api/http';
import { useRechargeUiStore } from '@/stores/recharge';
import {
  blockIfQuotaInsufficient,
  isQuotaExhaustedError,
  isQuotaInsufficient,
  openRechargeForQuotaError,
} from './quotaGate';

describe('isQuotaInsufficient', () => {
  it.each([
    [null, false],
    [undefined, false],
    [0, true],
    [-1, true],
    [1, false],
    [50000, false],
  ] as const)('quota=%s → %s', (quota, expected) => {
    expect(isQuotaInsufficient(quota)).toBe(expected);
  });
});

describe('blockIfQuotaInsufficient', () => {
  beforeEach(() => {
    useRechargeUiStore.getState().closeRecharge();
  });

  it('拦截 0 余额并打开充值弹框', () => {
    expect(blockIfQuotaInsufficient(0)).toBe(true);
    expect(useRechargeUiStore.getState().open).toBe(true);
  });

  it('余额充足不打开弹框', () => {
    expect(blockIfQuotaInsufficient(50000)).toBe(false);
    expect(useRechargeUiStore.getState().open).toBe(false);
  });

  it('未拉取配额不拦截', () => {
    expect(blockIfQuotaInsufficient(null)).toBe(false);
    expect(useRechargeUiStore.getState().open).toBe(false);
  });
});

describe('isQuotaExhaustedError', () => {
  it('识别 402 / payment_required / quota_exhausted', () => {
    expect(isQuotaExhaustedError(new ApiError(402, '余额不足', 'quota_exhausted'))).toBe(true);
    expect(isQuotaExhaustedError(new ApiError(402, '需支付', 'payment_required'))).toBe(true);
    expect(isQuotaExhaustedError(new ApiError(403, '余额不足', 'quota_exhausted'))).toBe(true);
    expect(isQuotaExhaustedError(new ApiError(400, '参数错误', 'bad_request'))).toBe(false);
    expect(isQuotaExhaustedError(new Error('network'))).toBe(false);
  });
});

describe('openRechargeForQuotaError', () => {
  beforeEach(() => {
    useRechargeUiStore.getState().closeRecharge();
  });

  it('余额耗尽错误打开弹框', () => {
    expect(openRechargeForQuotaError(new ApiError(402, '余额不足', 'quota_exhausted'))).toBe(true);
    expect(useRechargeUiStore.getState().open).toBe(true);
  });

  it('其它错误不打开弹框', () => {
    expect(openRechargeForQuotaError(new ApiError(500, '内部错误', 'internal'))).toBe(false);
    expect(useRechargeUiStore.getState().open).toBe(false);
  });
});
