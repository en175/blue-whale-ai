package com.bluewhale.billing.ledger;

/**
 * 预扣结果（《计费逻辑详细设计》§4.2）。
 *
 * @param reservedCredits 实际冻结到的积分（mc）；等于请求额（不足则抛异常，不会部分成功）
 * @param catalogVersion  本次预扣冻结的定价版本
 */
public record HoldResult(long reservedCredits, int catalogVersion) {}
