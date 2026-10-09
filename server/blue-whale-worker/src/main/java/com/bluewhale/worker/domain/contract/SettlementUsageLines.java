package com.bluewhale.worker.domain.contract;

import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class SettlementUsageLines {

    private static final Logger log = LoggerFactory.getLogger(SettlementUsageLines.class);

    public static final String SUCCEEDED_SLOTS = "usage.succeededSlots";

    public static final String REFERENCE_COUNT = "usage.referenceCount";

    public static final String COMPLETION_TOKENS = "usage.c";

    public static final String SECONDS = "usage.seconds";

    private static final String REFERENCES_KEY = "references";

    private static final String IMAGE_REFERENCES_KEY = "input_asset_ids";

    private static final Set<String> CONTENT_FIELDS = Set.of("prompt", "title", "provider_credential");

    private static final ObjectMapper JSON = new ObjectMapper();

    private SettlementUsageLines() {
    }

    public static List<Map<String, Object>> forJob(GenerationJobEntity job, int succeededSlots,
                                                   Long upstreamTotalTokens, Long upstreamSeconds) {
        Map<String, Object> input = parseObject(job.getInput());
        String modelId = input.get("model_id") instanceof String s && !s.isBlank() ? s : null;
        if (modelId == null || job.getType() == null || job.getType().isBlank()) {
            return List.of();
        }
        Map<String, Object> quantities = new LinkedHashMap<>();
        quantities.put(SUCCEEDED_SLOTS, succeededSlots);
        quantities.put(REFERENCE_COUNT, referenceCount(input, job.getType()));
        if (upstreamTotalTokens != null && upstreamTotalTokens > 0) {
            quantities.put(COMPLETION_TOKENS, upstreamTotalTokens);
        }
        if (upstreamSeconds != null && upstreamSeconds > 0) {
            quantities.put(SECONDS, upstreamSeconds);
        }

        Map<String, Object> line = new LinkedHashMap<>();
        line.put("modelId", modelId);
        line.put("taskType", job.getType());
        line.put("quantities", quantities);
        line.put("specs", specsOf(input));
        return List.of(line);
    }

    private static int referenceCount(Map<String, Object> input, String type) {
        return referenceList(input, type).size();
    }

    private static List<?> referenceList(Map<String, Object> input, String type) {
        if ("image".equals(type) && input.get(IMAGE_REFERENCES_KEY) instanceof List<?> ids) {
            return ids;
        }
        return input.get(REFERENCES_KEY) instanceof List<?> references ? references : List.of();
    }

    private static boolean hasVideoInput(Map<String, Object> input) {
        if (!(input.get(REFERENCES_KEY) instanceof List<?> references)) {
            return false;
        }
        for (Object ref : references) {
            if (ref instanceof Map<?, ?> entry && "video".equals(entry.get("type"))) {
                return true;
            }
        }
        return false;
    }

    private static Map<String, String> specsOf(Map<String, Object> input) {
        Map<String, String> specs = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : input.entrySet()) {
            String key = entry.getKey();
            if (key == null || CONTENT_FIELDS.contains(key.toLowerCase())) {
                continue;
            }
            String value = scalar(entry.getValue());
            if (value == null) {
                continue;
            }
            specs.put(key.toLowerCase(), value.toLowerCase());
        }
        specs.put(VIDEO_TIER, hasVideoInput(input) ? VIDEO_TIER_WITH : VIDEO_TIER_WITHOUT);
        Long inputSeconds = videoInputSeconds(input);
        if (inputSeconds != null) {
            specs.put(VIDEO_INPUT_SECONDS, String.valueOf(inputSeconds));
        }
        return specs;
    }

    private static final String VIDEO_TIER = "video";

    private static final String VIDEO_TIER_WITHOUT = "0";

    private static final String VIDEO_TIER_WITH = "1";

    private static final String VIDEO_INPUT_SECONDS = "video_input_seconds";

    private static Long videoInputSeconds(Map<String, Object> input) {
        if (!(input.get(REFERENCES_KEY) instanceof List<?> references)) {
            return null;
        }
        long total = 0L;
        boolean any = false;
        for (Object ref : references) {
            if (!(ref instanceof Map<?, ?> entry) || !"video".equals(entry.get("type"))) {
                continue;
            }
            any = true;
            Object raw = entry.get("duration");
            if (!(raw instanceof Number n) || n.doubleValue() <= 0) {
                return null;
            }
            total += n.longValue();
        }
        return any ? total : null;
    }

    private static String scalar(Object value) {
        if (value instanceof String s) {
            return s;
        }
        if (value instanceof Boolean b) {
            return b.toString();
        }
        if (value instanceof Double d) {
            return d == Math.floor(d) && !d.isInfinite()
                    ? String.valueOf(d.longValue())
                    : d.toString();
        }
        if (value instanceof Number n) {
            return n.toString();
        }
        return null;
    }

    private static Map<String, Object> parseObject(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        try {
            Map<?, ?> parsed = JSON.readValue(json, Map.class);
            Map<String, Object> input = new LinkedHashMap<>();
            parsed.forEach((k, v) -> {
                if (k != null) {
                    input.put(k.toString(), v);
                }
            });
            return input;
        } catch (Exception e) {
            log.warn("结算用量：job.input 不是合法 JSON，按空规格处理：{}", e.getMessage());
            return Map.of();
        }
    }
}
