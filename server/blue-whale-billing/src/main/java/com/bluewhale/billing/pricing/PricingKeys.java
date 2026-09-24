package com.bluewhale.billing.pricing;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 规格键的规范化与查表工具（《计费逻辑详细设计》§4.5.1）。
 *
 * <p><b>为什么必须先规范化</b>：口径不一致会让同一份规格查出两个结果——
 * 「seedream 矩阵配一半」「sizes 小写 1k vs 大写 1K 导致空表」两个已发生的 bug，
 * 根因都是「同一份规格语义有多种写法」。规范化把这种可能性从源头掐掉。
 *
 * <p>规则：维度名与值都 trim + lowercase，按键名排序，用 {@code |} 连接。
 * <pre>
 *   {"Size":"2K", "duration":"5"}  →  "duration=5|size=2k"
 * </pre>
 *
 * <p><b>调用时机</b>：目录加载时对 {@code TablePrice} 的键**预计算一次**，
 * 运行时只做等值查找。每次调用都重算字符串既浪费 CPU，也容易与写入端不一致。
 */
public final class PricingKeys {

    private PricingKeys() {}

    /** 分隔符。选 {@code |} 是因为它不会出现在维度名或规格值里（如 {@code 1792x1024}）。 */
    public static final String SEPARATOR = "|";
    private static final String ASSIGN = "=";

    /**
     * 全量规范化：把规格表拼成可比较的键。
     *
     * @param specs 原始规格，允许 null（视为空）
     * @return 规范化后的键；空入参返回空串
     */
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

    /**
     * 只取「表里声明过的那些维度」拼键——查表用。
     *
     * <p><b>为什么不能直接用 {@link #normalize}</b>：请求里的规格往往比某个表声明的轴多
     * （用户传了 size + duration，而这张表只按 size 定价）。若把多余维度也拼进键，
     * 永远查不到。这里的语义是「只按这张表的轴去匹配」。
     *
     * @param specs 请求规格
     * @param tableKeys 表里已有键的集合；从中抽出维度名清单
     */
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

    /**
     * 规范化**一个已有的表键**（把它本身重新拼成规范形式）。
     *
     * <p>表键是运营手写的，可能写成 {@code "Size=2K"} 或 {@code "size=2k|duration=5"}。
     * 编译期统一重拼，运行时只做等值查找——两端用同一份规范化结果，
     * 「写入与查询写法不一致」这类 bug 从源头消失。
     *
     * @param rawKey 形如 {@code "size=2k"} 或 {@code "duration=5|size=2k"}（顺序任意）
     * @throws IllegalArgumentException 键里没有 {@code =}
     */
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

    /** 从表键集合里抽出出现过的维度名（去重、有序）。 */
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

    /**
     * 按维度名取值，**大小写与空白不敏感**——调用方的规格来自 HTTP / proto，写法不可控。
     */
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
