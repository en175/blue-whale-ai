package com.bluewhale.billing.domain.pricing;

import java.util.Arrays;
import java.util.Map;

public enum UsageDim {

    CONSTANT_ONE("constant:1", null),

    SUCCEEDED_SLOTS("usage.succeededSlots", new ContractSource.SpecKey("expected_output_count")),

    SECONDS("usage.seconds", new ContractSource.SpecKey("duration")),

    CHARACTERS("usage.characters", new ContractSource.SpecKey("prompt_characters")),

    REFERENCE_COUNT("usage.referenceCount", new ContractSource.SpecKey("reference_count")),

    REFERENCE_SECONDS("usage.referenceSeconds", new ContractSource.SpecKey("reference_seconds")),

    VIDEO_EDIT("usage.videoEdit", new ContractSource.SpecKey("video_edit")),


    PROMPT_TOKENS("usage.p", null),
    COMPLETION_TOKENS("usage.c", null),
    CACHE_READ_TOKENS("usage.cr", null),
    CACHE_WRITE_5M_TOKENS("usage.cc5m", null),
    CACHE_WRITE_1H_TOKENS("usage.cc1h", null),
    REASONING_TOKENS("usage.reasoning", null),
    IMAGE_INPUT_TOKENS("usage.imgIn", null),
    AUDIO_INPUT_TOKENS("usage.audioIn", null),
    TOTAL_INPUT_LENGTH("usage.len", null);

    private final String key;
    private final ContractSource contractSource;

    UsageDim(String key, ContractSource contractSource) {
        this.key = key;
        this.contractSource = contractSource;
    }

    public String key() {
        return key;
    }

    public ContractSource contractSource() {
        return contractSource;
    }

    private static final Map<String, UsageDim> BY_KEY =
            Arrays.stream(values()).collect(java.util.stream.Collectors.toUnmodifiableMap(UsageDim::key, d -> d));

    public static UsageDim of(String key) {
        UsageDim dim = key == null ? null : BY_KEY.get(key.trim());
        if (dim == null) {
            throw new UnknownUsageDimException(key);
        }
        return dim;
    }

    public long quantityOf(Map<UsageDim, Long> quantities) {
        if (this == CONSTANT_ONE) {
            return 1L;
        }
        Long value = quantities.get(this);
        return value == null ? 0L : value;
    }

    public static class UnknownUsageDimException extends RuntimeException {
        public UnknownUsageDimException(String key) {
            super("未知的用量维度键：" + key + "（合法值见 UsageDim 枚举）");
        }
    }
}
