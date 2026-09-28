package com.bluewhale.worker.config;

/**
 * 跨语言测试向量：**由 TS 侧 {@code credentials-crypto.ts} 真实产出**的
 * {@code system_settings} 密文信封（用当前源码生成后逐字抄来），给 Java 侧的
 * 解封与读取用例共用。
 *
 * <p>单独放一个类而不是塞进某个用例里：信封格式是**两个语言共同遵守的契约**，
 * 消费它的用例不只一个，各抄一份长 base64 只会让格式变更时漏改一处。
 *
 * <p>⚠️ 下面的主密钥与 key 全是**假值**，只为验证格式，不是任何环境在用的凭证。
 */
public final class SystemSettingEnvelopeVectors {

    /** 假主密钥：64 位十六进制（等同的 base64 写法见 {@code SystemSettingEnvelopeTest}）。 */
    public static final String FAKE_SECRET_HEX =
            "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

    /** 明文 {@code {"new_api_key":"sk-vector-fake-key-9f2a"}} 的信封。 */
    public static final String PLAINTEXT = "{\"new_api_key\":\"sk-vector-fake-key-9f2a\"}";

    /** 上面明文里的 key。 */
    public static final String FAKE_KEY = "sk-vector-fake-key-9f2a";

    /** {@link #PLAINTEXT} 的信封。 */
    public static final String ENVELOPE =
            "v1.xt__tErc5qHxcuqR._KnoABVnFcst29BwPuw0PQ."
                    + "sjj2V5zDhdX9bqd3mbJxBXIuHA9AZcvqWnl_8ZWa4-NQTedisXcBUSo";

    /** 明文为 {@code {"new_api_key":""}} 的信封：验「配了半份 = 没配」。 */
    public static final String BLANK_KEY_ENVELOPE =
            "v1.QNpcHLXY5kKkVHbg.0P7vHBCTtTCEM2IhjHYC4A.3zUyU8_yhLcQI7t9iCT87SSF";

    /** 明文为另一把 key 的信封：验「读点不缓存，改完即生效」。 */
    public static final String ROTATED_ENVELOPE =
            "v1.tCmEyRHMR599w3yu.YWscfoAmmz242Q5PCjlDnw."
                    + "RCka_q4wlix1QzK6kZKgL39hGOnkAH46Ns0RAWQne3McbSp0dRX_m25J";

    /** {@link #ROTATED_ENVELOPE} 里的 key。 */
    public static final String ROTATED_KEY = "sk-rotated-fake-key-0001";

    private SystemSettingEnvelopeVectors() {
    }
}
