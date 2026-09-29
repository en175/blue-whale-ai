package com.bluewhale.billing.adapter.outbound.persistence.row;

/**
 * 「按来源拆分的可用积分」读模型行
 * （{@link com.bluewhale.billing.adapter.outbound.persistence.mapper.CreditLotMapper#sumAvailableBySource} 的返回）。
 *
 * <p>它是 {@code sumAvailable} 那个标量的**分项版本**：同一条 WHERE、同一个表达式
 * {@code SUM(remaining - frozen)}，只是多了 {@code GROUP BY source}。
 * 所以对任一用户，{@code Σ credits} 与 {@code sumAvailable} 必然相等 ——
 * 相等不是巧合，是两者共用同一套谓词的结果。任何一边改了谓词，这个等式就断了。
 */
public class SourceAvailableRow {

    /** {@code CreditSource.key()}：purchased / bonus / daily / … */
    private String source;

    /** 该类可用积分 Σ(remaining − frozen)。 */
    private Long credits;

    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }
    public Long getCredits() { return credits; }
    public void setCredits(Long credits) { this.credits = credits; }
}
