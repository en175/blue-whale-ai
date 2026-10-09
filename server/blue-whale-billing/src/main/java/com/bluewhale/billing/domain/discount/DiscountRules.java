package com.bluewhale.billing.domain.discount;

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

public final class DiscountRules {

    public static final int FULL_PRICE_BP = 10_000;

    public static final Set<String> TIERS = Set.of("free", "basic", "pro", "max");

    public static final Set<String> MEMBER_STATUSES = Set.of("enabled", "disabled");

    public static final Set<String> PROMOTION_STATUSES = Set.of("draft", "enabled", "disabled", "expired");

    private static final Pattern CODE = Pattern.compile("^[a-z0-9][a-z0-9_-]{0,63}$");

    private static final ObjectMapper JSON = new ObjectMapper();

    private DiscountRules() {}


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

    public static int priority(Integer raw) {
        if (raw == null) {
            return 0;
        }
        if (raw < 0 || raw > 1_000_000) {
            throw new IllegalArgumentException("优先级取值区间 0 ~ 1000000");
        }
        return raw;
    }


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

    public static String code(String raw) {
        String value = text(raw, 64, "活动标识");
        if (!CODE.matcher(value).matches()) {
            throw new IllegalArgumentException(
                    "活动标识只能用小写字母、数字、下划线与连字符，且以字母或数字开头（如 night-70）");
        }
        return value;
    }

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

    public static List<String> patterns(List<String> raw, int maxLength, String field, boolean required) {
        if (raw == null) {
            if (required) {
                throw new IllegalArgumentException(field + "必填（全部填 * ）");
            }
            return null;
        }
        Set<String> deduped = new LinkedHashSet<>();
        for (String item : raw) {
            if (item == null || item.isBlank()) {
                continue;
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


    public static String tier(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (!TIERS.contains(value)) {
            throw new IllegalArgumentException("会员等级只能是 " + sorted(TIERS) + " 之一");
        }
        return value;
    }

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
            return fallback;
        }
        if (!allowed.contains(value)) {
            throw new IllegalArgumentException(field + "只能是 " + sorted(allowed) + " 之一");
        }
        return value;
    }


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

    public static void window(LocalDateTime startAt, LocalDateTime endAt) {
        if (startAt == null || endAt == null) {
            throw new IllegalArgumentException("起始时间与结束时间都必填");
        }
        if (!endAt.isAfter(startAt)) {
            throw new IllegalArgumentException("结束时间必须晚于起始时间（活动区间是 [起始, 结束)）");
        }
    }

    public static void dailyWindow(LocalTime start, LocalTime end) {
        if ((start == null) != (end == null)) {
            throw new IllegalArgumentException("每日时段要么都填、要么都留空（留空 = 全天）");
        }
    }

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


    public static String toJson(List<?> values) {
        if (values == null || values.isEmpty()) {
            return null;
        }
        try {
            return JSON.writeValueAsString(values);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("折扣条件序列化成 JSON 失败", e);
        }
    }

    private static String sorted(Set<String> values) {
        return new ArrayList<>(new TreeSet<>(values)).toString();
    }
}
