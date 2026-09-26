package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.infrastructure.gateway.ImageProtocol;

/**
 * 渠道：这个模型走哪家、请求怎么解析、出站用哪种线协议。
 * <p>
 * 取值形如 {@code <家族>-<媒介>[-<协议>]}，是能力行列 {@code channel} 的**封闭枚举**——
 * 加渠道就是往这里加一条，别处不新增分支。
 * <p>
 * 取代了原先「{@code channel_parser} 列 × {@code features.image_protocol} JSON 键」两个字段：
 * 那两个说的是一件事的两半，却住在两个地方、两种形态。**换协议 = 新渠道**，所以
 * {@link #GPT_IMAGE}（内联）与 {@link #GPT_IMAGE_OPENAI}（官方协议）是两条，不是同一个渠道的
 * 两个开关——否则就能配出 {@code parser=banana × openai-images} 这种必然 400 的组合。
 * <p>
 * ⚠️ 非图片媒介（video / audio / text）的 {@link #parser()} 与 {@link #protocol()} 恒为
 * {@code null}：它们的请求不做映射，也没有出站协议之分。它们在这里是为了让「一个模型一个渠道」
 * 对所有行的成立，读侧不用按类型分叉。
 * <p>
 * ⚠️ 本枚举与 TS 侧 {@code backend/libs/shared/generation/image-channel-parser.ts} 的
 * {@code CHANNELS} 表是**两份实现、一份契约**（跨语言没有共享常量源）。两边靠
 * {@code channel-table-parity.test.ts} 逐条对账钉住——改一边不改另一边就是测试红。
 */
public enum ImageChannel {

    SEEDREAM_IMAGE("seedream-image", "image", "seedream", ImageProtocol.INLINE_IMAGE),
    GPT_IMAGE("gpt-image", "image", "gpt", ImageProtocol.INLINE_IMAGE),
    GPT_IMAGE_OPENAI("gpt-image-openai", "image", "gpt", ImageProtocol.OPENAI_IMAGES),
    BANANA_IMAGE("banana-image", "image", "banana", ImageProtocol.INLINE_IMAGE),
    SEEDREAM_VIDEO("seedream-video", "video", null, null),
    SEEDREAM_AUDIO("seedream-audio", "audio", null, null),
    SEEDREAM_TEXT("seedream-text", "text", null, null);

    private final String wireValue;
    private final String media;
    private final String parser;
    private final ImageProtocol protocol;

    ImageChannel(String wireValue, String media, String parser, ImageProtocol protocol) {
        this.wireValue = wireValue;
        this.media = media;
        this.parser = parser;
        this.protocol = protocol;
    }

    /** 能力行 {@code channel} 列里的字面值（kebab-case）。 */
    public String wireValue() {
        return wireValue;
    }

    /** 媒介，与能力行 {@code capability_type} 同域。 */
    public String media() {
        return media;
    }

    /** 请求字段的映射策略；非图片媒介为 {@code null}。 */
    public String parser() {
        return parser;
    }

    /** 出站线协议；非图片媒介为 {@code null}。 */
    public ImageProtocol protocol() {
        return protocol;
    }

    /**
     * 字面值 → 枚举；**不认识就返回 {@code null}**，由调用方决定回落与告警。
     * <p>
     * 刻意不在这里兜底：**「没配」与「配错」是两回事**。
     * 列是 NOT NULL，空值只会来自直接改库，静默回落不该吵；值存在却认不出则是配置错误，
     * 被静默咽掉会让排查从「这个模型整个挂了」开始，而根因埋在 DB 的 channel 列里。
     */
    public static ImageChannel fromWire(String raw) {
        if (raw == null) return null;
        String value = raw.trim();
        if (value.isEmpty()) return null;
        for (ImageChannel channel : values()) {
            if (channel.wireValue.equalsIgnoreCase(value)) return channel;
        }
        return null;
    }

    /**
     * 该媒介的缺省渠道：{@code channel} 列为 NULL（尚未回填 / 新建行）时的回落。
     * <p>
     * **按媒介分**而不是恒回落 {@code seedream-image}——一个 video 行读到 NULL 若回落成
     * {@code seedream-image}，媒体闸门会在下一次保存时把它判成非法，而运营什么都没改。
     * <p>
     * 与 TS 侧 {@code defaultChannelFor} 同口径。
     */
    public static ImageChannel defaultFor(String capabilityType) {
        if (capabilityType == null) return SEEDREAM_IMAGE;
        switch (capabilityType.trim().toLowerCase()) {
            case "video":
                return SEEDREAM_VIDEO;
            case "audio":
                return SEEDREAM_AUDIO;
            case "text":
                return SEEDREAM_TEXT;
            default:
                return SEEDREAM_IMAGE;
        }
    }
}
