package com.bluewhale.billing.domain.pricing;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

public final class PricingKeys {

    private PricingKeys() {}

    public static final String SEPARATOR = "|";
    private static final String ASSIGN = "=";

    public static String normalize(Map<String, String> specs) {
        if (specs == null || specs.isEmpty()) {
            return "";
        }
        return specs.entrySet().stream()
                .filter(e -> e.getKey() != null && e.getValue() != null)
                .map(e -> normalizeOne(e.getKey()) + ASSIGN + normalizeOne(e.getValue()))
                .sorted()
                .collect(Collectors.joining(SEPARATOR));
    }

    public static String normalizeSubset(Map<String, String> specs, Iterable<String> tableKeys) {
        if (specs == null || specs.isEmpty()) {
            return "";
        }
        var axes = axesOf(tableKeys);
        Map<String, String> picked = new LinkedHashMap<>();
        for (String axis : axes) {
            String value = valueOf(specs, axis);
            if (value != null) {
                picked.put(axis, value);
            }
        }
        return normalize(picked);
    }

    public static String normalizeKey(String rawKey) {
        if (rawKey == null || rawKey.isBlank()) {
            throw new IllegalArgumentException("空的规格键");
        }
        Map<String, String> pairs = new LinkedHashMap<>();
        for (String pair : rawKey.split("\\" + SEPARATOR)) {
            int at = pair.indexOf(ASSIGN);
            if (at <= 0) {
                throw new IllegalArgumentException("规格键缺少 '='：" + pair + "（完整键：" + rawKey + "）");
            }
            pairs.put(normalizeOne(pair.substring(0, at)), normalizeOne(pair.substring(at + 1)));
        }
        return normalize(pairs);
    }

    public static java.util.Set<String> axesOf(Iterable<String> tableKeys) {
        var axes = new java.util.TreeSet<String>();
        for (String key : tableKeys) {
            for (String pair : key.split("\\" + SEPARATOR)) {
                int at = pair.indexOf(ASSIGN);
                if (at > 0) {
                    axes.add(pair.substring(0, at));
                }
            }
        }
        return axes;
    }

    private static String valueOf(Map<String, String> specs, String axis) {
        for (var e : specs.entrySet()) {
            if (e.getKey() != null && normalizeOne(e.getKey()).equals(axis)) {
                return e.getValue();
            }
        }
        return null;
    }

    private static String normalizeOne(String raw) {
        return raw.trim().toLowerCase(Locale.ROOT);
    }
}
