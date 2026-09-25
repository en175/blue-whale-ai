package com.bluewhale.billing.pricing;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 视频 token 估算器 —— 火山（方舟）官方 token 计费公式的运行时形态。
 *
 * <h2>公式</h2>
 *
 * <pre>
 *   估算 token ≈ 输出宽 × 输出高 × 输出帧率 × 输出时长 ÷ divisor   （× 片段数）
 * </pre>
 *
 * <p>无视频输入 / 参考时输入时长按 0；含视频输入时官方要再加「输入时长」那一项，
 * 但**提交时刻拿不到输入视频的时长**（冻结快照里只有素材 id），所以本类只算产出那部分，
 * 见 {@code estimateVideoTokens} 的 ⚠️。
 *
 * <h2>为什么它只服务预扣</h2>
 *
 * token 数的**权威来源是上游返回**（{@code usage.total_tokens}，不可用时回退
 * {@code usage.completion_tokens}），worker 在终态事件里上报它，结算按它计价。
 * 本估算**只**用于提交时刻冻一个上限——两者混起来就是「预扣用什么、结算也用什么」，
 * 等于把估算误差变成真实收费误差（《计费逻辑详细设计》§4.5 计费准确四规则）。
 *
 * <h2>为什么公式在代码里、参数在目录里</h2>
 *
 * {@code divisor} / {@code fps} / 「档位 + 比例 → 宽高」三样都是**运营可能改的数**
 * （火山改口径、开新档位、调帧率），所以它们放在定价目录的 {@code tokenEstimate} 里，
 * 与目录一起版本化、一起回滚。本类只固定公式的**形状**，不含任何具体数值。
 *
 * <p>⚠️ 目录里查不到「档位 + 比例」这一组合时返回 {@code null}（＝这次推不出），
 * **不降级为 0、也不兜一个别的档位**：按 0 计价只会冻到下限，差额由平台承担且账面无信号；
 * 兜一个别的档位是按另一个档位收钱。两者都比如实报告「取不到」更坏。
 */
public final class TokenEstimator {

    /** 一个「档位 + 比例」对应的输出宽高（像素）。 */
    public record Dimensions(long width, long height) {

        public Dimensions {
            if (width <= 0 || height <= 0) {
                throw new IllegalArgumentException("宽高必须为正：" + width + "x" + height);
            }
        }

        /**
         * 解析目录里的字面值，形如 {@code "1248x704"}。
         *
         * @throws IllegalArgumentException 格式不对——**加载期就该拒绝**，
         *         不能等到某次预扣才发现（那时用户已经在等了）
         */
        public static Dimensions parse(String raw) {
            if (raw == null) {
                throw new IllegalArgumentException("宽高不能为空");
            }
            String[] parts = raw.trim().toLowerCase(java.util.Locale.ROOT).split("x");
            if (parts.length != 2) {
                throw new IllegalArgumentException("宽高要写成 宽x高（如 1248x704），实际：" + raw);
            }
            try {
                return new Dimensions(Long.parseLong(parts[0].trim()), Long.parseLong(parts[1].trim()));
            } catch (NumberFormatException e) {
                throw new IllegalArgumentException("宽高不是整数：" + raw);
            }
        }
    }

    private final long divisor;
    private final long fps;
    /** 已规范化的「档位 + 比例」键 → 宽高（规范化见 {@link PricingKeys#normalizeKey}）。 */
    private final Map<String, Dimensions> dimensions;

    public TokenEstimator(long divisor, long fps, Map<String, Dimensions> dimensions) {
        if (divisor <= 0) {
            throw new IllegalArgumentException("divisor 必须为正：" + divisor);
        }
        if (fps <= 0) {
            throw new IllegalArgumentException("fps 必须为正：" + fps);
        }
        if (dimensions == null || dimensions.isEmpty()) {
            throw new IllegalArgumentException("tokenEstimate 的尺寸表不能为空");
        }
        this.divisor = divisor;
        this.fps = fps;
        this.dimensions = Map.copyOf(dimensions);
    }

    /** 目录里声明的尺寸表（键已规范化）；供管理端与测试查看，不参与计价。 */
    public Map<String, Dimensions> dimensions() {
        return dimensions;
    }

    public long divisor() {
        return divisor;
    }

    public long fps() {
        return fps;
    }

    /**
     * 估算一次产出的 token 数。
     *
     * @param specs         本次规格（含 {@code resolution} / {@code aspect_ratio} 等定价轴）
     * @param outputSeconds 产出时长（秒）；{@code null} / 非正 = 时长未知
     *                      （{@code duration=-1} 的自动时长就是这种），返回 {@code null}
     * @param segments      片段数（产出槽数）；{@code <= 0} 视为 1
     * @return 估算 token；档位 + 比例在目录里没配、或时长未知 → {@code null}（＝这次推不出）
     *
     * <p>⚠️ <b>含视频输入时官方还要加「输入时长 × 宽 × 高 × 帧率 ÷ divisor」那一项</b>，
     * 而冻结快照里只有参考素材的 id、没有它的时长，提交时刻算不出来。所以这里的估算对
     * **带视频输入的任务是偏低的**；代价由「结算按上游真实 token 计价」兜住，
     * 但预扣会少冻一截（缺口上界 = 输入时长那一项）。要补齐得让接纳侧把参考视频的时长
     * 冻结进规格快照，那是另一单的事。
     */
    public Long estimateVideoTokens(Map<String, String> specs, Long outputSeconds, long segments) {
        if (outputSeconds == null || outputSeconds <= 0) {
            return null;
        }
        String key = PricingKeys.normalizeSubset(specs, dimensions.keySet());
        Dimensions dims = dimensions.get(key);
        if (dims == null) {
            return null;
        }
        long count = segments <= 0 ? 1L : segments;
        return dims.width() * dims.height() * fps * outputSeconds / divisor * count;
    }

    /**
     * 编译期构造：把目录里的字面尺寸表（{@code "resolution=480p|aspect_ratio=16:9" → "864x480"}）
     * 规范化并解析成运行时形态。
     *
     * <p>键用 {@link PricingKeys#normalizeKey} 重新拼装，与 {@code basePrice.table} 完全同一套写法
     * ——运营不必记两套键语法，运行时也只做等值查找。
     *
     * @throws IllegalArgumentException 键不规范、值不是宽x高、或两个键规范化后等价
     */
    public static TokenEstimator from(
            long divisor, long fps, Map<String, String> rawDimensions) {
        Map<String, Dimensions> normalized = new LinkedHashMap<>();
        Map<String, String> originals = new LinkedHashMap<>();
        for (var entry : rawDimensions.entrySet()) {
            String canonical = PricingKeys.normalizeKey(entry.getKey());
            String previous = originals.putIfAbsent(canonical, entry.getKey());
            if (previous != null) {
                throw new IllegalArgumentException("尺寸表存在等价键：" + previous + " 与 " + entry.getKey()
                        + " 规范化后都是 " + canonical + " —— 请删掉一个");
            }
            normalized.put(canonical, Dimensions.parse(entry.getValue()));
        }
        return new TokenEstimator(divisor, fps, normalized);
    }
}
