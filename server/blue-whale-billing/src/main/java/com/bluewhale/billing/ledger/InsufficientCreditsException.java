package com.bluewhale.billing.ledger;

/**
 * 余额不足（《计费逻辑详细设计》§4.2）。
 *
 * <p>调用方映射为 <b>HTTP 402 / gRPC FAILED_PRECONDITION</b>，且**不创建 job**——
 * 先扣费后提交，还是先提交后扣费，是两条完全不同的失败路径。
 * 这里选前者：扣不动就不要开始干活，避免「干了活却收不到钱」。
 *
 * <p>带上 {@code available} 与 {@code required}，是因为上层要据此给出可操作的提示
 * （「还差 40 积分」比「余额不足」有用得多）。
 */
public class InsufficientCreditsException extends RuntimeException {

    private final long available;
    private final long required;

    public InsufficientCreditsException(long available, long required) {
        super("积分不足：可用 " + available + "，需要 " + required + "，还差 " + (required - available));
        this.available = available;
        this.required = required;
    }

    /** 当前可用积分（mc）。 */
    public long available() {
        return available;
    }

    /** 本次需要的积分（mc）。 */
    public long required() {
        return required;
    }
}
