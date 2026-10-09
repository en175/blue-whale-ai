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

final class ImageChannelMapper {

    private static final Logger log = LoggerFactory.getLogger(ImageChannelMapper.class);

    private static final ObjectMapper JSON = new ObjectMapper();

    static final int DEFAULT_IMAGE_REFERENCE_MAX = 10;

    private ImageChannelMapper() {}


    static boolean hasSizeMatrix(String requestMappingJson) {
        Object matrix = parseJsonObj(requestMappingJson).get("matrix");
        return matrix instanceof Map<?, ?> m && !m.isEmpty();
    }

    static String resolveSeedreamSize(String requestMappingJson, String resolution, String ratio) {
        if (resolution == null || ratio == null) return null;
        Object matrix = parseJsonObj(requestMappingJson).get("matrix");
        if (!(matrix instanceof Map<?, ?> raw)) return null;
        Map<String, Map<String, String>> parsed = castMatrix(raw);

        Map<String, String> resTable = parsed.get(resolution.toUpperCase());
        if (resTable == null) {
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


    record MappedRequest(boolean ok, String size, String quality) {}

    static ImageRequestMapping parseStoredMapping(
            ImageChannel channel, String requestMappingJson,
            String defaultSizeId, String defaultRatioId
    ) {
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
        String quality = lookupIgnoreCase(mapping.quality, sizeOptionId);
        if (quality == null) quality = lookupIgnoreCase(mapping.quality, mapping.defaultSizeId);
        String size = lookupIgnoreCase(mapping.size, ratioId);
        if (size == null) size = lookupIgnoreCase(mapping.size, mapping.defaultRatioId);
        if (!filled(quality) || !filled(size)) {
            return new MappedRequest(false, null, null);
        }
        return new MappedRequest(true, size, quality);
    }


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

    record ImageRequestMapping(
            String parser,
            Map<String, Map<String, String>> matrix,
            Map<String, String> quality,
            Map<String, String> size,
            String defaultSizeId,
            String defaultRatioId
    ) {}
}
