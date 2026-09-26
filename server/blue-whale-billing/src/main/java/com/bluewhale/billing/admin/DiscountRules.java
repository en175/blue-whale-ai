package com.bluewhale.billing.admin;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.time.DateTimeException;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;

/**
 * 折扣两张 live 表（{@code billing_member_discounts} / {@code billing_promotions}）的
 * **写入校验**（《计费逻辑详细设计》§2.6 / §2.7）。
 *
 * <h2>为什么要有这一层：管理界面不是自由表单</h2>
 *
 * <p>这两张表原先只能改 SQL。改 SQL 的人至少读过 DDL —— 他知道 {@code discount_bp} 是万分比
 * （顺手写个 {@code 0.9} 进去就是「原价的十万分之九」，等于白送）、知道 {@code model_ids}
 * 的 JSON 空数组的含义是**不限**而不是「都不匹配」、知道 {@code daily_time} 只有一半
 * 会被计价侧当成「全天」。界面一上，这些前提全部消失：运营看到的是输入框。
 *
 * <p>所以规则写在这里，而不是指望填表的人先读 DDL。**每条规则都带一句人话**——
 * 校验失败回到界面上的是「折扣必须大于 0（万分比，10000 = 原价）」，
 * 而不是一个 500 或者一句「参数错误」。
 *
 * <h2>校验的边界：只拦「一定错」，不拦「可能不划算」</h2>
 *
 * <p>配一个 1 折的活动是运营的权力（底线 {@code floorFactorBp} 会兜住亏本），
 * 所以这里不拦；而 {@code discount_bp = 0} 一定错（那是白送），拦。
 * 区分标准是「这条数据会让计价侧读出与填写者意图不同的东西吗」。
 *
 * <p>⚠️ 本类**不查库**：唯一性（活动标识）要查库，放在控制器里，DB 的唯一索引是最终兜底。
 */
public final class DiscountRules {

    /** 原价：万分比 10000。 */
    public static final int FULL_PRICE_BP = 10_000;

    /** 会员等级。**权威定义在 backend 的 {@code libs/core/identity/tier.ts}**，此处是它的副本。 */
    public static final Set<String> TIERS = Set.of("free", "basic", "pro", "max");

    public static final Set<String> MEMBER_STATUSES = Set.of("enabled", "disabled");

    /**
     * 活动状态。{@code expired} 也在取值里（DDL 写了四个），但它是**时间走到头**的结果，
     * 不是运营手选的状态 —— 界面上可选的是前三个，接口放宽为四个。
     */
    public static final Set<String> PROMOTION_STATUSES = Set.of("draft", "enabled", "disabled", "expired");

    /** 活动标识：审计/排查用的稳定码，所以限死可读字符集（大写与中文会让它对不上日志）。 */
    private static final Pattern CODE = Pattern.compile("^[a-z0-9][a-z0-9_-]{0,63}$");

    private static final ObjectMapper JSON = new ObjectMapper();

    private DiscountRules() {}

    // ─────────────────────────────────────────────────────────────
    // 数值
    // ─────────────────────────────────────────────────────────────

    /**
     * 折扣系数：万分比整数。
     *
     * <p>⚠️ 上界必须是 10000 而不是「随便填」：大于 10000 是**加价**，
     * 而两张折扣表在计价侧只有一个语义（乘数），写成 15000 的人以为自己填的是 1.5 折。
     * 那不是一个折扣，是另一次改价，该去能力行的 pricing 里改单价。
     */
    public static int discountBp(Integer raw) {
        if (raw == null) {
            throw new IllegalArgumentException("折扣必填（万分比，10000 = 原价）");
        }
        if (raw <= 0) {
            throw new IllegalArgumentException("折扣必须大于 0：万分比 0 表示免费，不是「打 0 折」的笔误空间");
        }
        if (raw > FULL_PRICE_BP) {
            throw new IllegalArgumentException(
                    "折扣不能大于 " + FULL_PRICE_BP + "（万分比，10000 = 原价）：大于它是加价，不是折扣");
        }
        return raw;
    }

    /** 展示优先级之类的排序字段：可以不填（用 0），但填了就得是个整数范围内的值。 */
    public static int priority(Integer raw) {
        if (raw == null) {
            return 0;
        }
        if (raw < 0 || raw > 1_000_000) {
            throw new IllegalArgumentException("优先级取值区间 0 ~ 1000000");
        }
        return raw;
    }

    // ─────────────────────────────────────────────────────────────
    // 文本与模式
    // ─────────────────────────────────────────────────────────────

    /** 必填文本（活动名称、活动标识的原料）。 */
    public static String text(String raw, int maxLength, String field) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) {
            throw new IllegalArgumentException(field + "必填");
        }
        if (value.length() > maxLength) {
            throw new IllegalArgumentException(field + "最长 " + maxLength + " 个字符");
        }
        return value;
    }

    /** 活动标识：小写字母/数字开头，只含小写字母、数字、下划线、连字符。 */
    public static String code(String raw) {
        String value = text(raw, 64, "活动标识");
        if (!CODE.matcher(value).matches()) {
            throw new IllegalArgumentException(
                    "活动标识只能用小写字母、数字、下划线与连字符，且以字母或数字开头（如 night-70）");
        }
        return value;
    }

    /**
     * 单个匹配模式（会员折扣的 {@code model_pattern} / {@code task_pattern}）。
     *
     * <p>与 {@code discount/Patterns} 的实现严格对齐：只认 {@code *}、尾部单个 {@code *}
     * 的前缀、以及精确匹配。⚠️ 中间带 {@code *}（{@code a-*-b}）在计价侧**匹配不到任何东西**
     * —— 它会静默地让这条规则永不生效，比配错更坏，所以在写入侧就拒掉。
     */
    public static String pattern(String raw, int maxLength, String field) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) {
            throw new IllegalArgumentException(field + "必填（全匹配写 * ）");
        }
        if (value.length() > maxLength) {
            throw new IllegalArgumentException(field + "最长 " + maxLength + " 个字符");
        }
        if (value.chars().anyMatch(Character::isWhitespace)) {
            throw new IllegalArgumentException(field + "不能含空格");
        }
        int star = value.indexOf('*');
        if (star >= 0 && star != value.length() - 1) {
            throw new IllegalArgumentException(
                    field + "的通配符只支持放在结尾（如 seedance-* ）或单独一个 * ：" +
                            "中间带 * 的写法（a-*-b）在计价侧匹配不到任何东西");
        }
        return value.toLowerCase(Locale.ROOT);
    }

    /**
     * 模式集合（营销活动的 {@code model_ids} / {@code task_types}）。
     *
     * <p>⚠️ **空集合与 NULL 是同一个语义：不限。** 计价侧 {@code Patterns.matchesAny} 对
     * 空集合返回 true（「没配」不该解读为「都不匹配」）。所以这里把空集合**归一成 null** ——
     * 库里同时存在 {@code NULL} 与 {@code []} 两种「不限」，只会让人在下一次排查时
     * 多花半小时去确认它们是不是同一个意思。
     *
     * @param required true = 必须给出至少一个模式。营销活动的 {@code model_ids} 是 NOT NULL
     *                 且空数组等于「全部模型打折」—— 一个「限时活动」把全站模型都打折，
     *                 几乎不会是填写者的意图，所以强制显式写 {@code *}
     */
    public static List<String> patterns(List<String> raw, int maxLength, String field, boolean required) {
        if (raw == null) {
            if (required) {
                throw new IllegalArgumentException(field + "必填（全部填 * ）");
            }
            return null;
        }
        // 去重但保留顺序：运营填的顺序就是他阅读的顺序，重排会让「怎么和我填的不一样」
        Set<String> deduped = new LinkedHashSet<>();
        for (String item : raw) {
            if (item == null || item.isBlank()) {
                continue;   // 界面上的空行不该被当成一个模式
            }
            deduped.add(pattern(item, maxLength, field));
        }
        if (deduped.isEmpty()) {
            if (required) {
                throw new IllegalArgumentException(field + "必填（全部填 * ）");
            }
            return null;
        }
        return List.copyOf(deduped);
    }

    // ─────────────────────────────────────────────────────────────
    // 枚举
    // ─────────────────────────────────────────────────────────────

    /** 会员等级：与 backend 的 {@code Tier} 同一套字面值。 */
    public static String tier(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (!TIERS.contains(value)) {
            throw new IllegalArgumentException("会员等级只能是 " + sorted(TIERS) + " 之一");
        }
        return value;
    }

    /** 等级范围；空 = 不限（归一成 null，理由同 {@link #patterns}）。 */
    public static List<String> tierScope(List<String> raw) {
        if (raw == null) {
            return null;
        }
        Set<String> tiers = new LinkedHashSet<>();
        for (String item : raw) {
            if (item == null || item.isBlank()) {
                continue;
            }
            tiers.add(tier(item));
        }
        return tiers.isEmpty() ? null : List.copyOf(tiers);
    }

    public static String memberStatus(String raw) {
        return ofEnum(raw, MEMBER_STATUSES, "enabled", "状态");
    }

    public static String promotionStatus(String raw) {
        return ofEnum(raw, PROMOTION_STATUSES, "draft", "状态");
    }

    private static String ofEnum(String raw, Set<String> allowed, String fallback, String field) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) {
            return fallback;   // 不填 = 用默认值，而不是报错
        }
        if (!allowed.contains(value)) {
            throw new IllegalArgumentException(field + "只能是 " + sorted(allowed) + " 之一");
        }
        return value;
    }

    // ─────────────────────────────────────────────────────────────
    // 时间
    // ─────────────────────────────────────────────────────────────

    /**
     * 时区名（ADR-0111 北京时间口径）。
     *
     * <p>⚠️ 这里必须真正解析一次（{@link ZoneId#of}）而不是看它非空就放行：
     * 计价侧 {@code ZoneId.of(row.tz)} 是在**预扣路径上**抛异常的，
     * 一个拼错的时区名会让所有命中它的任务提交失败 —— 那是把配置错误变成了线上故障。
     */
    public static String timezone(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) {
            throw new IllegalArgumentException("时区必填：跨零点时段（22:00→06:00）没有时区必然算错");
        }
        try {
            ZoneId.of(value);
        } catch (DateTimeException e) {
            throw new IllegalArgumentException("时区名不合法（如 Asia/Shanghai）：" + value);
        }
        return value;
    }

    /** 活动总时间窗：半开区间 {@code [start, end)}，所以必须严格有 end > start。 */
    public static void window(LocalDateTime startAt, LocalDateTime endAt) {
        if (startAt == null || endAt == null) {
            throw new IllegalArgumentException("起始时间与结束时间都必填");
        }
        if (!endAt.isAfter(startAt)) {
            throw new IllegalArgumentException("结束时间必须晚于起始时间（活动区间是 [起始, 结束)）");
        }
    }

    /**
     * 每日时段：**要么都填、要么都留空**。
     *
     * <p>⚠️ 只填一半在计价侧等于「全天」（{@code dailyStart == null || dailyEnd == null}
     * 直接放行）——填报的人以为自己限定了时段，实际是一条全天折扣。
     * 这是「配置与意图不符」的典型，写入侧直接拒。
     */
    public static void dailyWindow(LocalTime start, LocalTime end) {
        if ((start == null) != (end == null)) {
            throw new IllegalArgumentException("每日时段要么都填、要么都留空（留空 = 全天）");
        }
    }

    /** 生效星期 [1..7]（1 = 周一，与 {@code DayOfWeek.getValue()} 同口径）；空 = 每天。 */
    public static List<Integer> daysOfWeek(List<Integer> raw) {
        if (raw == null) {
            return null;
        }
        Set<Integer> days = new TreeSet<>();
        for (Integer day : raw) {
            if (day == null) {
                continue;
            }
            if (day < 1 || day > 7) {
                throw new IllegalArgumentException("生效星期取值范围 1（周一）~ 7（周日）");
            }
            days.add(day);
        }
        return days.isEmpty() ? null : List.copyOf(days);
    }

    // ─────────────────────────────────────────────────────────────
    // JSON 列：读回永不为坏值，写出恒为数组或 NULL
    // ─────────────────────────────────────────────────────────────

    /**
     * 集合 → JSON 列文本；**空集合与 null 都写成 NULL**（归一，理由见 {@link #patterns}）。
     *
     * <p>写的是文本而不是让 MyBatis 处理：实体里这几列就是 String（见 {@code PromotionEntity}），
     * 与 {@code PromotionDiscountProvider} 的读取形态一致 —— 存取两端同一套形态，
     * 少一层「实体里是 List、库里是 JSON」的隐式转换。
     */
    public static String toJson(List<?> values) {
        if (values == null || values.isEmpty()) {
            return null;
        }
        try {
            return JSON.writeValueAsString(values);
        } catch (JsonProcessingException e) {
            // 我们只序列化 List<String> / List<Integer>，走到这里说明是编码问题而不是数据问题
            throw new IllegalStateException("折扣条件序列化成 JSON 失败", e);
        }
    }

    private static String sorted(Set<String> values) {
        return new ArrayList<>(new TreeSet<>(values)).toString();
    }
}
