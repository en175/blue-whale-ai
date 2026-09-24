package com.bluewhale.billing.discount;

import java.util.Locale;

/**
 * 折扣规则的 target 模式匹配。
 *
 * <p>支持三种形态，**刻意只有三种**——通用 glob / 正则会让运营写出没人能推理的匹配，
 * 出问题时无法回答「这条规则为什么命中了」。
 *
 * <ul>
 *   <li>{@code *} —— 全匹配</li>
 *   <li>{@code seedance-*} —— 前缀匹配（前缀后任意）</li>
 *   <li>{@code seedance-2.5} —— 精确匹配</li>
 * </ul>
 *
 * <p>大小写不敏感：模型 / 任务标识来自上游与配置，写法不统一就没有可比较性。
 */
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
            // 只认尾部单个 *：中间带 * 的（如 a-*-b）不支持，见类注释
            return v.startsWith(p.substring(0, p.length() - 1));
        }
        return p.equals(v);
    }

    /**
     * 目标集合里**任一**命中即算命中。
     *
     * @param patterns 集合；null / 空表示「不限」，此时返回 true
     */
    public static boolean matchesAny(Iterable<String> patterns, String value) {
        if (patterns == null) {
            return true;
        }
        var iterator = patterns.iterator();
        if (!iterator.hasNext()) {
            return true;   // 空集合 = 不限，与 null 同义（「没配」不该解读为「都不匹配」）
        }
        for (String pattern : patterns) {
            if (matches(pattern, value)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 集合是否限定范围（非空）。
     *
     * <p>用于区分「没配」与「配了但都不匹配」——前者放行，后者拒绝。
     * 泛型放宽到 {@code Iterable<?>}：调用方既有 {@code Set<String>}（等级范围）
     * 也有 {@code Set<Integer>}（星期），判断「空不空」与元素类型无关。
     */
    public static boolean isRestricted(Iterable<?> patterns) {
        return patterns != null && patterns.iterator().hasNext();
    }
}
