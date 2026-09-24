package com.bluewhale.billing.ledger;

/**
 * 会计科目（《计费逻辑详细设计》§2.2.1）。
 *
 * <p>五个科目构成一套最小但完整的复式记账：
 * <pre>
 *   wallet / frozen          —— 用户侧（可用 vs 冻结）
 *   revenue / cost           —— 平台侧（收入 vs 成本）
 *   receivable               —— 应收（超扣、欠费）
 * </pre>
 *
 * <p><b>为什么「冻结」是独立科目而不是 wallet 的一个标记</b>：
 * 复式记账要求每笔业务动作**借贷合计相等**。提交预扣时钱没花掉、只是不能用了，
 * 这在会计上是「资产从可用转为受限」——必须有两边的分录，否则试算表不平，
 * 对账时无法判断某笔钱到底花没花。
 */
public enum Account {

    /** 用户可用积分。自然方向：**贷**（贷方余额 = 用户还有多少可用）。 */
    WALLET("wallet", false),

    /**
     * 用户冻结积分。自然方向：**贷**。
     *
     * <p>与 WALLET 同向，因为两者是**同一笔钱的两个状态**（可用 vs 受限），
     * 只是位置不同。预扣时 {@code 借 wallet / 贷 frozen} 正好表达「余额从可用挪到受限」：
     * wallet 减少、frozen 等量增加，两者之和（即用户总资产）不变。
     *
     * <p>于是有一条恒等式可直接用来对账（§9 层次①）：
     * <pre>
     *   balance(wallet) + balance(frozen) == Σ lots.remaining
     * </pre>
     */
    FROZEN("frozen", false),

    /** 平台收入（**付费**积分被消耗）。 */
    REVENUE("revenue", false),

    /** 平台成本（**赠送**积分被消耗 / 上游成本）。 */
    COST("cost", true),

    /** 应收（超扣、欠费）。 */
    RECEIVABLE("receivable", true);

    private final String key;
    private final boolean normalDebit;

    Account(String key, boolean normalDebit) {
        this.key = key;
        this.normalDebit = normalDebit;
    }

    public String key() {
        return key;
    }

    /**
     * 该科目的**自然余额方向**。
     *
     * <p>用来把分录的有符号增减统一成「正数 = 该科目有正向余额」——
     * 否则 wallet 的余额会算成负数（贷方余额按「借−贷」是负的），
     * 对账时读起来反直觉，人工排查容易看反。
     */
    public boolean normalDebit() {
        return normalDebit;
    }

    /**
     * 一笔分录对本科目余额的**有符号贡献**。
     *
     * <pre>
     *   balance_after(本笔) = balance_after(上一笔) + delta
     * </pre>
     *
     * @return 正数 = 余额增加；负数 = 余额减少
     */
    public long balanceDelta(LedgerEntry.Direction direction, long amount) {
        boolean isDebit = direction == LedgerEntry.Direction.DEBIT;
        return isDebit == normalDebit ? amount : -amount;
    }

    public static Account of(String key) {
        for (Account account : values()) {
            if (account.key.equals(key)) {
                return account;
            }
        }
        throw new IllegalArgumentException("未知的会计科目：" + key);
    }
}
