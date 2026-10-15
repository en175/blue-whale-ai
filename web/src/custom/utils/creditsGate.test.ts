import { describe, expect, it, beforeEach } from 'vitest';
import { ApiError } from '@/shared/api/http';
import { useRechargeUiStore } from '@/custom/stores/recharge';
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
  it('识别个人余额不足（402 + 1001）/ payment_required / quota_exhausted', () => {
    expect(isCreditsExhaustedError(new ApiError(402, '账户余额不足，请充值后重试', 1001))).toBe(true);
    expect(isCreditsExhaustedError(new ApiError(402, '余额不足', 'quota_exhausted'))).toBe(true);
    expect(isCreditsExhaustedError(new ApiError(402, '需支付', 'payment_required'))).toBe(true);
    expect(isCreditsExhaustedError(new ApiError(403, '余额不足', 'quota_exhausted'))).toBe(true);
    expect(isCreditsExhaustedError(new ApiError(400, '参数错误', 'bad_request'))).toBe(false);
    expect(isCreditsExhaustedError(new Error('network'))).toBe(false);
  });

  it('ADR-0128：平台额度不足不引导个人充值', () => {
    expect(
      isCreditsExhaustedError(
        new ApiError(402, '生成服务额度不足，请联系平台管理员', 'platform_quota_exhausted'),
      ),
    ).toBe(false);
    expect(isCreditsExhaustedError(new ApiError(402, '生成服务额度不足', 1061))).toBe(false);
    expect(isCreditsExhaustedError(new ApiError(402, '积分不足'))).toBe(true);
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
