package com.bluewhale.billing.pricing;

import java.util.Map;

/**
 * 基准单价解析（《计费逻辑详细设计》§4.6.4 策略）。
 *
 * <p>两种形态覆盖全部模态：**常数**（文本 / 按次）与**按轴查表**（图片按尺寸档、视频按分辨率）。
 *
 * <p>sealed：新增形态必须显式登记，编译器会强制所有 switch 处理它——
 * 「加了实现却漏了分支」这类静默出错在 sealed 下不可能发生。
 */
public sealed interface BasePriceResolver permits BasePriceResolver.Constant, BasePriceResolver.Table {

    /**
     * @param specs 原始规格（未规范化；实现内部负责规范化）
     * @return 基准单价，单位 mc（1 积分 = 1000 mc）
     * @throws UnpriceableSpecException 按轴查表时该规格组合没配价
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

    /** 该规格组合没有配置价格——说明目录漏配，是配置错误不是用户错误。 */
    class UnpriceableSpecException extends RuntimeException {
        private final String normalizedKey;

        public UnpriceableSpecException(String normalizedKey) {
            super("该规格组合未配置价格：" + normalizedKey);
            this.normalizedKey = normalizedKey;
        }

        public String normalizedKey() {
            return normalizedKey;
        }
    }
}
