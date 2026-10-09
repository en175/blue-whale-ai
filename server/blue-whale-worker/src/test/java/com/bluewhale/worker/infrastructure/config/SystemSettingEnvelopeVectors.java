package com.bluewhale.worker.infrastructure.config;

public final class SystemSettingEnvelopeVectors {

    public static final String FAKE_SECRET_HEX =
            "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

    public static final String PLAINTEXT = "{\"new_api_key\":\"sk-vector-fake-key-9f2a\"}";

    public static final String FAKE_KEY = "sk-vector-fake-key-9f2a";

    public static final String ENVELOPE =
            "v1.xt__tErc5qHxcuqR._KnoABVnFcst29BwPuw0PQ."
                    + "sjj2V5zDhdX9bqd3mbJxBXIuHA9AZcvqWnl_8ZWa4-NQTedisXcBUSo";

    public static final String BLANK_KEY_ENVELOPE =
            "v1.QNpcHLXY5kKkVHbg.0P7vHBCTtTCEM2IhjHYC4A.3zUyU8_yhLcQI7t9iCT87SSF";

    public static final String ROTATED_ENVELOPE =
            "v1.tCmEyRHMR599w3yu.YWscfoAmmz242Q5PCjlDnw."
                    + "RCka_q4wlix1QzK6kZKgL39hGOnkAH46Ns0RAWQne3McbSp0dRX_m25J";

    public static final String ROTATED_KEY = "sk-rotated-fake-key-0001";

    private SystemSettingEnvelopeVectors() {
    }
}
