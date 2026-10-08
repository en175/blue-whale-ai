package com.bluewhale.billing.domain.pricing;

import java.util.LinkedHashMap;
import java.util.Map;

public final class TokenEstimator {

    public record Dimensions(long width, long height) {

        public Dimensions {
            if (width <= 0 || height <= 0) {
                throw new IllegalArgumentException("宽高必须为正：" + width + "x" + height);
            }
        }
    }

    static final String VIDEO_TIER_KEY = "video";

    static final String VIDEO_TIER_WITH = "1";

    static final String OUTPUT_WIDTH_KEY = "output_width";

    static final String OUTPUT_HEIGHT_KEY = "output_height";

    private final long divisor;
    private final long fps;
    private final String inputSecondsKey;
    private final Map<String, Long> minimumTokens;

    public TokenEstimator(long divisor, long fps, String inputSecondsKey,
                          Map<String, Long> minimumTokens) {
        if (divisor <= 0) {
            throw new IllegalArgumentException("divisor 必须为正：" + divisor);
        }
        if (fps <= 0) {
            throw new IllegalArgumentException("fps 必须为正：" + fps);
        }
        this.divisor = divisor;
        this.fps = fps;
        this.inputSecondsKey =
                inputSecondsKey == null || inputSecondsKey.isBlank() ? null : inputSecondsKey.trim();
        this.minimumTokens = minimumTokens == null ? Map.of() : Map.copyOf(minimumTokens);
        for (var entry : this.minimumTokens.entrySet()) {
            if (entry.getValue() == null || entry.getValue() <= 0) {
                throw new IllegalArgumentException(
                        "最低 token 用量必须为正：" + entry.getKey() + " → " + entry.getValue());
            }
        }
    }

    public long divisor() {
        return divisor;
    }

    public long fps() {
        return fps;
    }

    public String inputSecondsKey() {
        return inputSecondsKey;
    }

    public Map<String, Long> minimumTokens() {
        return minimumTokens;
    }

    public boolean hasMinimumTokens() {
        return !minimumTokens.isEmpty();
    }

    public Long minimumTokensFor(Map<String, String> specs) {
        if (minimumTokens.isEmpty()) {
            return null;
        }
        return minimumTokens.get(PricingKeys.normalizeSubset(specs, minimumTokens.keySet()));
    }

    public Long estimateVideoTokens(Map<String, String> specs, Long outputSeconds, long segments) {
        if (outputSeconds == null || outputSeconds <= 0) {
            return null;
        }
        Dimensions dims = dimensionsFromSpecs(specs);
        if (dims == null) {
            return null;
        }
        long inputSeconds = 0L;
        if (inputSecondsKey != null && isVideoInput(specs)) {
            Long parsed = wholeSecondsOf(specs.get(inputSecondsKey));
            if (parsed == null) {
                return null;
            }
            inputSeconds = parsed;
        }
        long perVideo = dims.width() * dims.height() * fps * (outputSeconds + inputSeconds) / divisor;
        if (hasMinimumTokens() && isVideoInput(specs)) {
            Long floor = minimumTokensFor(specs);
            if (floor == null) {
                return null;
            }
            perVideo = Math.max(perVideo, floor);
        }
        long count = segments <= 0 ? 1L : segments;
        return perVideo * count;
    }

    private static Dimensions dimensionsFromSpecs(Map<String, String> specs) {
        Long width = positiveLongOf(specs.get(OUTPUT_WIDTH_KEY));
        Long height = positiveLongOf(specs.get(OUTPUT_HEIGHT_KEY));
        if (width == null || height == null) {
            return null;
        }
        return new Dimensions(width, height);
    }

    private static Long positiveLongOf(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            long value = new java.math.BigDecimal(raw.trim()).longValueExact();
            return value <= 0 ? null : value;
        } catch (NumberFormatException | ArithmeticException e) {
            return null;
        }
    }

    private static boolean isVideoInput(Map<String, String> specs) {        return VIDEO_TIER_WITH.equalsIgnoreCase(specs.get(VIDEO_TIER_KEY));
    }

    private static Long wholeSecondsOf(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            long value = new java.math.BigDecimal(raw.trim()).longValueExact();
            return value < 0 ? null : value;
        } catch (NumberFormatException | ArithmeticException e) {
            return null;
        }
    }

    public static TokenEstimator from(
            long divisor, long fps, String inputSecondsKey,
            Map<String, Long> rawMinimumTokens) {
        Map<String, Long> floors = new LinkedHashMap<>();
        Map<String, String> floorOriginals = new LinkedHashMap<>();
        if (rawMinimumTokens != null) {
            for (var entry : rawMinimumTokens.entrySet()) {
                String canonical = PricingKeys.normalizeKey(entry.getKey());
                String previous = floorOriginals.putIfAbsent(canonical, entry.getKey());
                if (previous != null) {
                    throw new IllegalArgumentException("最低 token 用量表存在等价键："
                            + previous + " 与 " + entry.getKey()
                            + " 规范化后都是 " + canonical + " —— 请删掉一个");
                }
                floors.put(canonical, entry.getValue());
            }
        }
        return new TokenEstimator(divisor, fps, inputSecondsKey, floors);
    }
}
