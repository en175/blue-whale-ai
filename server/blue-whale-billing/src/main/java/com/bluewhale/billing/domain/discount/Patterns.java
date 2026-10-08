package com.bluewhale.billing.domain.discount;

import java.util.Locale;

public final class Patterns {

    private Patterns() {}

    public static boolean matches(String pattern, String value) {
        if (pattern == null || pattern.isBlank() || value == null) {
            return false;
        }
        String p = pattern.trim().toLowerCase(Locale.ROOT);
        String v = value.trim().toLowerCase(Locale.ROOT);

        if ("*".equals(p)) {
            return true;
        }
        if (p.endsWith("*")) {
            return v.startsWith(p.substring(0, p.length() - 1));
        }
        return p.equals(v);
    }

    public static boolean matchesAny(Iterable<String> patterns, String value) {
        if (patterns == null) {
            return true;
        }
        var iterator = patterns.iterator();
        if (!iterator.hasNext()) {
            return true;
        }
        for (String pattern : patterns) {
            if (matches(pattern, value)) {
                return true;
            }
        }
        return false;
    }

    public static boolean isRestricted(Iterable<?> patterns) {
        return patterns != null && patterns.iterator().hasNext();
    }
}
