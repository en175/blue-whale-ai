package com.bluewhale.billing.domain.ledger;

/**
 * 预扣结果（《计费逻辑详细设计》§4.2）。
 *
 * @param reservedCredits 实际冻结到的积分；等于请求额（不足则抛异常，不会部分成功）
 * @param catalogVersion  本次预扣冻结的定价版本——调用方须把它冻结进 job，
 *                        结算时按它复现定价（改价不影响已提交任务）
 * @param duplicated      ★ 幂等命中：这次是**重放**，没有产生新的冻结与分录。
 *                        这是**正常结果**，不是错误——调用方应照常继续（客户端重试场景）。
 *                        把它显式带出来，是因为「返回了相同的数字」不足以区分
 *                        「刚扣的」与「上次就扣过的」，而调用方可能需要据此决定
 *                        要不要再写一次自己的副作用。
 */
public record HoldResult(long reservedCredits, int catalogVersion, boolean duplicated) {

    public static HoldResult fresh(long reservedCredits, int catalogVersion) {
        return new HoldResult(reservedCredits, catalogVersion, false);
    }

    public static HoldResult replay(long reservedCredits, int catalogVersion) {
        return new HoldResult(reservedCredits, catalogVersion, true);
    }
}
