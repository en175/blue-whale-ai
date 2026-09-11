package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.infrastructure.gateway.ImageProtocol;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 图片渠道映射器（image-channel-parser.ts + seedream-image-size.ts 逐字移植）。
 * <p>
 * 解析器类型：seedream（代码表查算）/ gpt（矩阵查表）/ banana（quality×size 双映射）。
 * <p>
 * 职责：把能力行的 channel_parser + request_mapping + 用户选的 sizeId/ratioId
 * 映射为 provider 级别的 size 和 quality 字符串。
 */
final class ImageChannelMapper {

    private static final ObjectMapper JSON = new ObjectMapper();

    /** 默认参考图上限（与 TS DEFAULT_MAX_REFERENCE_IMAGES 一致，generation-worker.ts:333）。 */
    static final int DEFAULT_MAX_REFERENCE_IMAGES = 10;

    private ImageChannelMapper() {}

    // ========== seedream 代码表（seedream-image-size.ts:21-108） ==========

    private static final String[] RATIOS = {
            "1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"
    };

    private static final Map<String, Map<String, Map<String, String>>> MODEL_SIZES;

    static {
        Map<String, Map<String, Map<String, String>>> m = new LinkedHashMap<>();
        m.put("doubao-seedream-5-0-pro-260628", Map.of(
                "1K", sizeTable("1024x1024","1152x864","864x1152","1424x800","800x1424","1248x832","832x1248","1568x672"),
                "2K", sizeTable("2048x2048","2368x1776","1776x2368","2816x1584","1584x2816","2496x1664","1664x2496","3136x1344")
        ));
        m.put("doubao-seedream-5-0-260128", Map.of(
                "2K", sizeTable("2048x2048","2304x1728","1728x2304","2848x1600","1600x2848","2496x1664","1664x2496","3136x1344"),
                "3K", sizeTable("3072x3072","3456x2592","2592x3456","4096x2304","2304x4096","3744x2496","2496x3744","4704x2016"),
                "4K", sizeTable("4096x4096","4704x3520","3520x4704","5504x3040","3040x5504","4992x3328","3328x4992","6240x2656")
        ));
        m.put("doubao-seedream-4-5-251128", Map.of(
                "2K", sizeTable("2048x2048","2304x1728","1728x2304","2848x1600","1600x2848","2496x1664","1664x2496","3136x1344"),
                "4K", sizeTable("4096x4096","4704x3520","3520x4704","5504x3040","3040x5504","4992x3328","3328x4992","6240x2656")
        ));
        m.put("doubao-seedream-4-0-250828", Map.of(
                "1K", sizeTable("1024x1024","1152x864","864x1152","1312x736","736x1312","1248x832","832x1248","1568x672"),
                "2K", sizeTable("2048x2048","2304x1728","1728x2304","2848x1600","1600x2848","2496x1664","1664x2496","3136x1344"),
                "4K", sizeTable("4096x4096","4704x3520","3520x4704","5504x3040","3040x5504","4992x3328","3328x4992","6240x2656")
        ));
        MODEL_SIZES = Collections.unmodifiableMap(m);
    }

    private static Map<String, String> sizeTable(String... values) {
        Map<String, String> table = new LinkedHashMap<>();
        for (int i = 0; i < RATIOS.length && i < values.length; i++) {
            table.put(RATIOS[i], values[i]);
        }
        return table;
    }

    /** seedream 族按代码表换算（seedream-image-size.ts:110-117）。 */
    static String resolveSeedreamImageSize(String modelId, String resolution, String ratio) {
        Map<String, Map<String, String>> modelTable = MODEL_SIZES.get(modelId);
        if (modelTable == null) return null;
        Map<String, String> resTable = modelTable.get(resolution.toUpperCase());
        if (resTable == null) return null;
        return resTable.get(ratio);
    }

    /** 模型是否在 seedream 分辨率查表族内（seedream-image-size.ts:120-122）。 */
    static boolean hasSeedreamSizeTable(String modelId) {
        return MODEL_SIZES.containsKey(modelId);
    }

    // ========== 渠道映射（image-channel-parser.ts） ==========

    /**
     * 渠道映射结果。
     * @param ok true = 映射成功；false = 组合不受支持
     * @param size provider 级别尺寸
     * @param quality provider 级别质量（banana 才有，其他为 null）
     */
    record MappedRequest(boolean ok, String size, String quality) {}

    /**
     * 解析存储的请求映射（image-channel-parser.ts:206-244 parseStoredImageRequestMapping）。
     * 返回结构化的映射对象供 mapImageChannelRequest 使用。
     */
    static ImageRequestMapping parseStoredMapping(
            String channelParser, String requestMappingJson,
            String defaultSizeId, String defaultRatioId
    ) {
        String parser = (channelParser != null && !channelParser.isEmpty())
                ? channelParser : "seedream";

        if ("seedream".equals(parser)) {
            return new ImageRequestMapping("seedream", null, null, null, null, null);
        }

        Map<String, Object> record = parseJsonObj(requestMappingJson);

        if ("gpt".equals(parser)) {
            @SuppressWarnings("unchecked")
            Map<String, Map<String, String>> matrix = record.containsKey("matrix")
                    && record.get("matrix") instanceof Map<?, ?> m
                    ? castMatrix(m) : Map.of();
            return new ImageRequestMapping("gpt", matrix, null, null, defaultSizeId, defaultRatioId);
        }

        // banana
        @SuppressWarnings("unchecked")
        Map<String, String> quality = record.containsKey("quality")
                && record.get("quality") instanceof Map<?, ?> q
                ? castStringMap(q) : Map.of();
        @SuppressWarnings("unchecked")
        Map<String, String> size = record.containsKey("size")
                && record.get("size") instanceof Map<?, ?> s
                ? castStringMap(s) : Map.of();
        return new ImageRequestMapping("banana", null, quality, size, defaultSizeId, defaultRatioId);
    }

    /**
     * 映射尺寸/宽高比到 provider 请求参数（image-channel-parser.ts:100-129 mapImageChannelRequest）。
     */
    static MappedRequest mapImageChannelRequest(
            ImageRequestMapping mapping, String sizeOptionId, String ratioId
    ) {
        if ("seedream".equals(mapping.parser)) {
            return new MappedRequest(false, null, null);
        }
        if ("gpt".equals(mapping.parser)) {
            String cell = lookupMatrixCell(mapping.matrix, sizeOptionId, ratioId);
            if (filled(cell)) return new MappedRequest(true, cell, null);
            String fallback = lookupMatrixCell(mapping.matrix,
                    mapping.defaultSizeId, mapping.defaultRatioId);
            if (filled(fallback)) return new MappedRequest(true, fallback, null);
            return new MappedRequest(false, null, null);
        }
        // banana
        String quality = lookupIgnoreCase(mapping.quality, sizeOptionId);
        if (quality == null) quality = lookupIgnoreCase(mapping.quality, mapping.defaultSizeId);
        String size = lookupIgnoreCase(mapping.size, ratioId);
        if (size == null) size = lookupIgnoreCase(mapping.size, mapping.defaultRatioId);
        if (!filled(quality) || !filled(size)) {
            return new MappedRequest(false, null, null);
        }
        return new MappedRequest(true, size, quality);
    }

    // ========== 内部工具 ==========

    private static String lookupIgnoreCase(Map<String, String> record, String key) {
        if (record == null || key == null || key.isEmpty()) return null;
        String v = record.get(key);
        if (filled(v)) return v;
        String lower = key.toLowerCase();
        for (Map.Entry<String, String> e : record.entrySet()) {
            if (e.getKey().toLowerCase().equals(lower) && filled(e.getValue())) {
                return e.getValue();
            }
        }
        return null;
    }

    private static String lookupMatrixCell(
            Map<String, Map<String, String>> matrix, String sizeId, String ratioId
    ) {
        if (matrix == null || sizeId == null || ratioId == null) return null;
        Map<String, String> row = matrix.get(sizeId);
        if (row == null) {
            String lower = sizeId.toLowerCase();
            for (Map.Entry<String, Map<String, String>> e : matrix.entrySet()) {
                if (e.getKey().toLowerCase().equals(lower)) {
                    return lookupIgnoreCase(e.getValue(), ratioId);
                }
            }
            return null;
        }
        return lookupIgnoreCase(row, ratioId);
    }

    private static boolean filled(String value) {
        return value != null && !value.trim().isEmpty();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, String> castStringMap(Map<?, ?> raw) {
        Map<String, String> result = new LinkedHashMap<>();
        for (Map.Entry<?, ?> e : raw.entrySet()) {
            if (e.getKey() instanceof String k && e.getValue() instanceof String v) {
                result.put(k, v);
            }
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Map<String, String>> castMatrix(Map<?, ?> raw) {
        Map<String, Map<String, String>> result = new LinkedHashMap<>();
        for (Map.Entry<?, ?> e : raw.entrySet()) {
            if (e.getKey() instanceof String k && e.getValue() instanceof Map<?, ?> v) {
                result.put(k, castStringMap(v));
            }
        }
        return result;
    }

    private static Map<String, Object> parseJsonObj(String json) {
        if (json == null || json.isBlank()) return Map.of();
        try {
            return JSON.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            return Map.of();
        }
    }

    /**
     * 从 features JSON 提取 max_reference_images（asset-ops.ts:127-139）。
     */
    static int parseMaxReferenceImages(String featuresJson) {
        if (featuresJson == null || featuresJson.isBlank()) return DEFAULT_MAX_REFERENCE_IMAGES;
        try {
            Map<String, Object> features = JSON.readValue(featuresJson,
                    new TypeReference<Map<String, Object>>() {});
            Object v = features.get("maxReferenceImages");
            if (v == null) v = features.get("max_reference_images");
            if (v instanceof Number n) return n.intValue();
            return DEFAULT_MAX_REFERENCE_IMAGES;
        } catch (Exception e) {
            return DEFAULT_MAX_REFERENCE_IMAGES;
        }
    }

    /**
     * 从 features JSON 提取 i2i_model_name（契约 §11 / ADR-0085，IKESD6）。
     * 读侧宽容：缺省 / 空白 / 非字符串 → null = 不分流（写侧闸门在 backend constants.ts）。
     * snake_case 与 camelCase 两种键形同 parseMaxReferenceImages。
     */
    static String parseI2iModelName(String featuresJson) {
        if (featuresJson == null || featuresJson.isBlank()) return null;
        try {
            Map<String, Object> features = JSON.readValue(featuresJson,
                    new TypeReference<Map<String, Object>>() {});
            Object v = features.get("i2iModelName");
            if (v == null) v = features.get("i2i_model_name");
            if (v instanceof String s && !s.isBlank()) return s.trim();
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * 从 features JSON 提取 image_protocol（契约 §11 / IKF4LI）。
     * <p>
     * 读侧宽容：缺省 / 空白 / 未知值 → {@link ImageProtocol#INLINE_IMAGE}（现状不变；协议切错的
     * 代价是全量调用失败，故宁可不切）。snake_case 与 camelCase 两种键形同 parseI2iModelName。
     */
    static ImageProtocol parseImageProtocol(String featuresJson) {
        if (featuresJson == null || featuresJson.isBlank()) return ImageProtocol.INLINE_IMAGE;
        try {
            Map<String, Object> features = JSON.readValue(featuresJson,
                    new TypeReference<Map<String, Object>>() {});
            Object v = features.get("imageProtocol");
            if (v == null) v = features.get("image_protocol");
            return ImageProtocol.fromWire(v instanceof String s ? s : null);
        } catch (Exception e) {
            return ImageProtocol.INLINE_IMAGE;
        }
    }

    /**
     * 从 supported_sizes JSON 匹配 sizeId（asset-ops.ts:111-126）。
     * @return [apiValue, width, height] 或 null
     */
    static String[] matchSupportedSize(String supportedSizesJson, String sizeId) {
        if (supportedSizesJson == null || supportedSizesJson.isBlank()
                || sizeId == null || sizeId.isEmpty()) return null;
        try {
            List<Map<String, Object>> sizes = JSON.readValue(supportedSizesJson,
                    new TypeReference<List<Map<String, Object>>>() {});
            for (Map<String, Object> s : sizes) {
                String id = strVal(s, "id");
                String apiValue = strVal(s, "api_value");
                String apiValueAlt = strVal(s, "apiValue");
                if (sizeId.equals(id) || sizeId.equals(apiValue) || sizeId.equals(apiValueAlt)) {
                    String av = apiValue != null ? apiValue : apiValueAlt;
                    Integer w = intVal(s, "width");
                    Integer h = intVal(s, "height");
                    return new String[]{
                            av,
                            w != null ? w.toString() : null,
                            h != null ? h.toString() : null
                    };
                }
            }
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    private static String strVal(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return (v instanceof String s && !s.isEmpty()) ? s : null;
    }

    private static Integer intVal(Map<String, Object> m, String key) {
        Object v = m.get(key);
        if (v instanceof Number n) return n.intValue();
        return null;
    }

    /** 渠道映射中间结构（对齐 TS ImageRequestMapping）。 */
    record ImageRequestMapping(
            String parser,
            Map<String, Map<String, String>> matrix,
            Map<String, String> quality,
            Map<String, String> size,
            String defaultSizeId,
            String defaultRatioId
    ) {}
}
