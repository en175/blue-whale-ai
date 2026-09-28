package com.bluewhale.billing.domain.pricing;

import java.util.Map;

/**
 * 基准单价解析（《计费逻辑详细设计》§4.6.4 策略）。
 *
 * <p>三种形态覆盖全部模态：**常数**（文本 / 按次）、**按轴查表**（图片按尺寸档、视频按分辨率）
 * 与**待配**（运营还没填这个模型的单价——规则里的一个空位）。
 *
 * <p>sealed：新增形态必须显式登记，编译器会强制所有 switch 处理它——
 * 「加了实现却漏了分支」这类静默出错在 sealed 下不可能发生。
 */
public sealed interface BasePriceResolver
        permits BasePriceResolver.Constant, BasePriceResolver.Table, BasePriceResolver.Unset {

    /**
     * @param specs 原始规格（未规范化；实现内部负责规范化）
     * @return 基准单价，单位 mc（1 积分 = 1000 mc）
     * @throws UnpriceableSpecException 按轴查表时该规格组合没配价，或单价还是个空位
     */
    long resolve(Map<String, String> specs);

    /** 常数单价：文本、按次。任何规格都返回同一个价。 */
    record Constant(long mc) implements BasePriceResolver {
        @Override
        public long resolve(Map<String, String> specs) {
            return mc;
        }
    }

    /**
     * 按轴查表：图片按尺寸档、视频按分辨率。
     *
     * <p><b>键必须是已规范化的</b>——目录加载时就做掉，运行时不重算（见 {@link PricingKeys}）。
     * 构造时校验，非法键直接拒绝，避免把一个永远查不到的键带进运行期。
     */
    record Table(Map<String, Long> table) implements BasePriceResolver {

        public Table {
            if (table == null || table.isEmpty()) {
                throw new IllegalArgumentException("按轴查表的定价不能为空表");
            }
        }

        @Override
        public long resolve(Map<String, String> specs) {
            // 只按本表声明过的轴匹配：请求里多出来的维度（如只按 size 定价却传了 duration）不参与
            String key = PricingKeys.normalizeSubset(specs, table.keySet());
            Long price = table.get(key);
            if (price == null) {
                // ⚠️ 查不到就**拒绝**，绝不降级为 0：
                //    降级为 0 会让「漏配」变成「免费」，用户白嫖且无人发现。
                //    拒绝会立刻暴露成 P1 告警（billing.pricing.unpriceable）。
                throw new UnpriceableSpecException(key);
            }
            return price;
        }
    }

    /**
     * 单价**待配** —— 规则里显式留的空位，运营还没填这个模型的数。
     *
     * <h2>为什么要有这一档，而不是「干脆不写这条规则」</h2>
     *
     * 不写规则 = 整个模型算不出价，连**规则本身**（基准维度 {@code usage.c}、
     * token 估算参数、单位分母）都没地方放，运营得从零手搓一条——而那些是别人已经量过、
     * 反推过的东西（例如火山官方对照表反推出来的宽高映射）。留个空位等于把「已知的部分配好、
     * 未知的那个数空着」，运营只填单价一个数。
     *
     * <h2>为什么空位必须是「拒绝」而不是 0</h2>
     *
     * 按 0 计价 = 免费生成：用户白嫖、账面无异常、且**没有任何信号**会让人发现这事。
     * 拒绝则当场暴露成一次提交失败 + 一条「补配置」的信号。
     * 与 {@link Table#resolve} 查不到规格同一个立场。
     *
     * <p>它与 {@link Table} 查不到键的区别只在**报错文案**：那个是「这条规格组合漏配」，
     * 这个是「这个模型的单价整块还没填」。两者都走 {@link UnpriceableSpecException}
     * ——调用方的处置完全相同（拒绝提交，不降级），所以不另开一条异常通道。
     */
    record Unset() implements BasePriceResolver {

        @Override
        public long resolve(Map<String, String> specs) {
            throw new UnpriceableSpecException(
                    "<单价待配>", "该模型的单价还没填 —— 能力行里这条规则的 basePrice 是空位"
                            + "（kind=unset）。请运营在管理端的「模型计费」页填上单价并保存；"
                            + "在此之前本模型的提交会被拒绝，**不会**按 0 免费");
        }
    }

    /** 该规格组合没有配置价格——说明规则漏配，是配置错误不是用户错误。 */
    class UnpriceableSpecException extends RuntimeException {
        private final String normalizedKey;

        public UnpriceableSpecException(String normalizedKey) {
            this(normalizedKey, "该规格组合未配置价格：" + normalizedKey);
        }

        /** 子类/特例用：报错文案自己给，但仍是「没配价」这一类（调用方按同一类处置）。 */
        protected UnpriceableSpecException(String normalizedKey, String message) {
            super(message);
            this.normalizedKey = normalizedKey;
        }

        public String normalizedKey() {
            return normalizedKey;
        }
    }
}
