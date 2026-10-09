package com.bluewhale.billing.infrastructure.discount;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;

public final class PatternJson {

    private static final Logger log = LoggerFactory.getLogger(PatternJson.class);

    private static final ObjectMapper JSON = new ObjectMapper();

    private PatternJson() {}

    public static List<String> stringList(String jsonText) {
        if (jsonText == null || jsonText.isBlank()) {
            return List.of();
        }
        try {
            return JSON.readValue(jsonText, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            log.warn("折扣条件的 JSON 列不是合法字符串数组，按「不限」处理：{}", jsonText, e);
            return List.of();
        }
    }

    public static List<Integer> intList(String jsonText) {
        if (jsonText == null || jsonText.isBlank()) {
            return List.of();
        }
        try {
            return JSON.readValue(jsonText, new TypeReference<List<Integer>>() {});
        } catch (Exception e) {
            log.warn("折扣条件的 JSON 列不是合法整数数组，按「不限」处理：{}", jsonText, e);
            return List.of();
        }
    }
}
