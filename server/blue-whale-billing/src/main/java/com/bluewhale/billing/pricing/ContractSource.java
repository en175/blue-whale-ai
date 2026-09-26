package com.bluewhale.billing.pricing;

/**
 * 契约量来源 —— **提交时刻这个维度的契约量从哪来**的封闭登记。
 *
 * <p>《计费逻辑详细设计》§4.6.4 的立场：预扣要冻一个上限，而上限来自「这次最多会产出多少」。
 * 提交时刻并没有真实用量（worker 还没跑），所以契约量必须**当场推出来**。推法只有两种：
 *
 * <ul>
 *   <li>{@link SpecKey}：值就在规格快照里（张数 / 时长 / 参考素材数）——**直读**。</li>
 *   <li>{@link Estimated}：规格里**没有这个键**，但按规则登记的估算参数能从别的规格推出来
 *       （视频 token：上游返回真值，提交时刻只能按官方公式估详见 {@link TokenEstimator}）。</li>
 * </ul>
 *
 * <p><b>为什么是 sealed</b>：与 {@link BasePriceResolver} 同一个理由——新增形态必须显式登记，
 * 编译器会强制所有 switch 处理它。「加了实现却漏了分支」这类静默出错在 sealed 下不可能发生。
 *
 * <p>⚠️ {@code null}（不是本接口的实例）表达的是第三件事：该维度**结构性**地没有契约量来源
 * （TTS 的字符数是模型生成出来的、提交时还不知道）。它与「这次的值取不到」是两回事：
 * 前者是配置立场，后者是本次传参问题——见 {@code BillingApplicationService#priceAtSubmit}。
 */
public sealed interface ContractSource {

    /**
     * 规格键直读：契约量就是 {@code specs} 里这个键的值。
     *
     * @param key job 规格快照（{@code specs}）里的键名，例如按槽计费的契约张数在
     *            {@code expected_output_count}
     */
    record SpecKey(String key) implements ContractSource {

        public SpecKey {
            if (key == null || key.isBlank()) {
                throw new IllegalArgumentException("契约量的规格键必填");
            }
        }
    }

    /**
     * 按目录登记的估算参数从规格推出来。
     *
     * <p>目前只有 {@code usage.c}（输出 token）登记为它：token 数由**上游返回**（权威、结算用它），
     * 提交时刻 specs 里根本没有这个键，只能按官方公式估一个上限——这就是「预扣估算、结算真实」
     * 两种用量的分工（见 {@link Usage} 的类注释）。
     */
    record Estimated() implements ContractSource {}
}
