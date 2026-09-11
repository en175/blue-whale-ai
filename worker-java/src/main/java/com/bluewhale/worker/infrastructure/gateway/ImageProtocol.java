package com.bluewhale.worker.infrastructure.gateway;

/**
 * 上游图片接口协议（IKF4LI）。
 * <p>
 * 由能力行 {@code features.image_protocol} 声明，**缺省 {@link #INLINE_IMAGE}**——
 * 未声明的图片行行为不变（banana / seedream 等）。
 * <p>
 * 2026-09-11 上游改造：gpt-image-2 换成官方 OpenAI Images 协议后，旧的
 * 「恒 generations + 参考图进 body.image」形态被上游硬拒（实测
 * {@code Unknown parameter: 'image'} / {@code 'response_format'}），故协议必须按行可配。
 * 这是**数据驱动**的分流，不按模型名特判。
 */
public enum ImageProtocol {

    /**
     * 官方 OpenAI Images 协议。
     * <ul>
     *   <li>无参考图 → {@code POST /v1/images/generations}（JSON）</li>
     *   <li>有参考图 → {@code POST /v1/images/edits}（multipart，参考图为文件字节）</li>
     *   <li>只发官方字段 model/prompt/n/size/quality；不发 response_format / stream /
     *       tools / watermark（前两者实测被上游 400 拒绝）</li>
     *   <li>模型名恒定，不因参考图换名（文生图/图生图同一档位）</li>
     * </ul>
     */
    OPENAI_IMAGES("openai-images"),

    /**
     * 旧形态（上游为火山 ARK / banana 系）：恒 {@code POST /v1/images/generations}（JSON），
     * 参考图以 URL 字符串/数组进 body {@code image} 字段；有参考图时可由
     * {@code features.i2i_model_name} 换上游模型名。
     */
    INLINE_IMAGE("inline-image");

    private final String wireValue;

    ImageProtocol(String wireValue) {
        this.wireValue = wireValue;
    }

    /** 能力行 features 里的字面值（kebab-case）。 */
    public String wireValue() {
        return wireValue;
    }

    /**
     * 字面值 → 枚举；**不认识就返回 {@code null}**，由调用方决定回落与告警。
     * <p>
     * 刻意不在这里兜底：**「没配」与「配错」是两回事**——缺省（键不存在）是常态、不该吵；
     * 值存在却认不出则是配置错误，被静默咽掉会让排查从「GPT Image 2 整个挂了」开始，
     * 而根因埋在 DB 里。回落决策与告警留在 {@code ImageChannelMapper.parseImageProtocol}。
     */
    public static ImageProtocol fromWire(String raw) {
        if (raw == null) return null;
        String value = raw.trim();
        if (value.isEmpty()) return null;
        for (ImageProtocol protocol : values()) {
            if (protocol.wireValue.equalsIgnoreCase(value)) return protocol;
        }
        return null;
    }
}
