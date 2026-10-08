package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.infrastructure.gateway.ImageProtocol;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

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

    private static final Logger log = LoggerFactory.getLogger(ImageChannelMapper.class);

    private static final ObjectMapper JSON = new ObjectMapper();

    /** 默认参考图上限（与 TS DEFAULT_IMAGE_REFERENCE_MAX 一致，图片/视频官方口径）。
     *  网关 blue-whale-api maxImageEditImages=10 / 火山方舟 Seedream 4.0/5.0「10 张复合编辑」（IKA72G）。
     *  IKHEXG：合并键 `image_reference_max` 的缺省按生成类型分——**图片/视频 10、音频 1**
     *  （音频常量在 TS 侧为 DEFAULT_IMAGE_REFERENCE_MAX_FOR_AUDIO；本进程只跑图片链路，故取 10）。 */
    static final int DEFAULT_IMAGE_REFERENCE_MAX = 10;

    private ImageChannelMapper() {}

    // ========== seedream 尺寸换算（IK629：数据源由代码表迁至能力行 request_mapping） ==========

    /** 能力行是否带尺寸矩阵（形状与 gpt 行的 request_mapping.matrix 一致）。 */
    static boolean hasSizeMatrix(String requestMappingJson) {
        Object matrix = parseJsonObj(requestMappingJson).get("matrix");
        return matrix instanceof Map<?, ?> m && !m.isEmpty();
    }

    /**
     * seedream 族尺寸换算：读能力行 {@code request_mapping.matrix[分辨率][宽高比]}。
     * <p>
     * IK629（2026-09-12）：原为代码内 MODEL_SIZES 表（写死模型名），现改读能力行——
     * 逐格值等价，上游新增/调整模型不再需要改代码发版（契约 §12「协议由能力行声明」）。
     */
    static String resolveSeedreamSize(String requestMappingJson, String resolution, String ratio) {
        if (resolution == null || ratio == null) return null;
        Object matrix = parseJsonObj(requestMappingJson).get("matrix");
        if (!(matrix instanceof Map<?, ?> raw)) return null;
        Map<String, Map<String, String>> parsed = castMatrix(raw);

        Map<String, String> resTable = parsed.get(resolution.toUpperCase());
        if (resTable == null) {
            // 键大小写兜底：能力行可能写 "1k" 而非 "1K"
            for (Map.Entry<String, Map<String, String>> e : parsed.entrySet()) {
                if (e.getKey().toUpperCase().equals(resolution.toUpperCase())) {
                    resTable = e.getValue();
                    break;
                }
            }
        }
        if (resTable == null) return null;
        return lookupIgnoreCase(resTable, ratio);
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
            ImageChannel channel, String requestMappingJson,
            String defaultSizeId, String defaultRatioId
    ) {
        // 解析器由**渠道**给出（非图片渠道为 null → 与旧列的 NOT NULL DEFAULT 对齐）。
        String parser = channel.parser() != null ? channel.parser() : "seedream";

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
     * 从 features JSON 提取 image_reference_max（asset-ops.ts:127-139）。
     */
    static int parseMaxReferenceImages(String featuresJson) {
        if (featuresJson == null || featuresJson.isBlank()) return DEFAULT_IMAGE_REFERENCE_MAX;
        try {
            Map<String, Object> features = JSON.readValue(featuresJson,
                    new TypeReference<Map<String, Object>>() {});
            Object v = features.get("imageReferenceMax");
            if (v == null) v = features.get("image_reference_max");
            if (v instanceof Number n) return n.intValue();
            return DEFAULT_IMAGE_REFERENCE_MAX;
        } catch (Exception e) {
            return DEFAULT_IMAGE_REFERENCE_MAX;
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
     * 归一能力行的 {@code channel} 列（TS 侧 {@code parseStoredChannel} 的同源实现）。
     * <p>
     * 读侧宽容但有痕：**空值**按 {@link ImageChannel#defaultFor} 静默回落（列是 NOT NULL，
     * 所以这不是为存量兜底，而是防直接改库造出的脏值）；**值存在却认不出 = 配置错误**，
     * 回落的同时打 WARN —— 静默咽掉会让排查从「这个模型整个挂了」开始，而根因埋在
     * DB 的 channel 列里。
     * <p>
     * 回落方向按媒介（video 行 → seedream-video），不恒落 seedream-image：
     * 一个 video 行读到 NULL 若落成图片渠道，媒体闸门会在下次保存时判它非法，
     * 而运营什么都没改。
     */
    static ImageChannel parseChannel(String channelColumn, String capabilityType) {
        if (channelColumn != null && !channelColumn.isBlank()) {
            ImageChannel parsed = ImageChannel.fromWire(channelColumn);
            if (parsed != null) return parsed;
            ImageChannel fallback = ImageChannel.defaultFor(capabilityType);
            log.warn("channel 取值不认识，回落 {}（该行解析/出站形态可能与配置意图不符）: {}",
                    fallback.wireValue(), channelColumn);
            return fallback;
        }
        return ImageChannel.defaultFor(capabilityType);
    }

    /**
     * 从 supported_sizes JSON 匹配 sizeId（asset-ops.ts:111-126）。
     * @return 该档位的出站值 api_value（缺省回落 id）或 null
     *
     * <p>IKHTVR：原先还一并返回该档位的 width / height，但调用方把这两个值赋给局部变量后
     * 再没读过（全文件零引用），条目里的宽高也没有任何消费方——故收敛掉，只返回出站值。
     */
    static String matchSupportedSize(String supportedSizesJson, String sizeId) {
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
                    // 出站值缺失时返回 null = 与「未命中」同路：调用方保持行级 api_size 兜底不变。
                    return apiValue != null ? apiValue : apiValueAlt;
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
