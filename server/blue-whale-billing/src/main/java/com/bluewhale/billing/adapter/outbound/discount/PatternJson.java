package com.bluewhale.billing.adapter.outbound.discount;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;

/**
 * 折扣条件里的 JSON 数组列（{@code model_ids} / {@code task_types} / {@code tier_scope} /
 * {@code days_of_week}）的解析。
 *
 * <p><b>为什么单独一个类</b>：解析这件事有两条读路径 —— 计价侧
 * （{@link PromotionDiscountProvider}，决定「这次到底打不打折」）与管理端
 * （{@code admin.AdminPromotionController}，决定「运营在界面上看到这条活动限了哪些模型」）。
 * 两处各写一份解析，就会出现「界面上显示限了 3 个模型、计价侧其实当成不限」——
 * 而两边各自的日志都正常。所以只留这一份。
 *
 * <p>⚠️ <b>坏 JSON 一律当「没配」（= 不限）并记 WARN</b>，解析失败不让整次计价崩：
 * 一条活动配错了不该让全站提交任务失败。但也不能静默 —— 静默放行意味着
 * 一条本该限 3 个模型的折扣变成了全站打折，那是在漏钱。所以：放行 + 留痕。
 */
public final class PatternJson {

    private static final Logger log = LoggerFactory.getLogger(PatternJson.class);

    private static final ObjectMapper JSON = new ObjectMapper();

    private PatternJson() {}

    /** 字符串数组列；null / 空串 / 坏 JSON 都是**空列表**（= 不限）。 */
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

    /** 整数数组列（生效星期）；null / 空串 / 坏 JSON 都是**空列表**（= 不限）。 */
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
