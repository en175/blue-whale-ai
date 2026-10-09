package com.bluewhale.billing.domain.discount;

import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DiscountRulesTest {


    @Test
    void 折扣系数上界是原价_大于它是加价不是折扣() {
        assertThat(DiscountRules.discountBp(10_000)).isEqualTo(10_000);
        assertThat(DiscountRules.discountBp(1)).isEqualTo(1);

        assertThatThrownBy(() -> DiscountRules.discountBp(10_001))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("不能大于 10000");
    }

    @Test
    void 折扣系数不能是0_那是免费() {
        assertThatThrownBy(() -> DiscountRules.discountBp(0))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("必须大于 0");
    }

    @Test
    void 折扣系数必填() {
        assertThatThrownBy(() -> DiscountRules.discountBp(null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("必填");
    }


    @Test
    void 模式认全匹配_前缀_精确三种形态() {
        assertThat(DiscountRules.pattern("*", 128, "模型匹配")).isEqualTo("*");
        assertThat(DiscountRules.pattern("Seedance-*", 128, "模型匹配")).isEqualTo("seedance-*");
        assertThat(DiscountRules.pattern(" gpt-4o ", 128, "模型匹配")).isEqualTo("gpt-4o");
    }

    @Test
    void 中间带星号的模式被拒_计价侧匹配不到任何东西() {
        assertThatThrownBy(() -> DiscountRules.pattern("seedance-*-pro", 128, "模型匹配"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("通配符只支持放在结尾");
    }

    @Test
    void 模式不能含空格() {
        assertThatThrownBy(() -> DiscountRules.pattern("gpt 4o", 128, "模型匹配"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("不能含空格");
    }

    @Test
    void 空集合与NULL都归一成NULL_因为不限只能有一种表示() {
        assertThat(DiscountRules.patterns(List.of(), 64, "任务类型范围", false)).isNull();
        assertThat(DiscountRules.patterns(null, 64, "任务类型范围", false)).isNull();
        assertThat(DiscountRules.patterns(List.of(" ", ""), 64, "任务类型范围", false)).isNull();
    }

    @Test
    void 必填的模式集合不能为空_活动必须显式写模型范围() {
        assertThatThrownBy(() -> DiscountRules.patterns(List.of(), 128, "模型范围", true))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("必填");
    }

    @Test
    void 模式集合去重且保留填写顺序() {
        assertThat(DiscountRules.patterns(List.of("A", "b", "a"), 128, "模型范围", true))
                .containsExactly("a", "b");
    }


    @Test
    void 会员等级只认四个字面值() {
        for (String tier : DiscountRules.TIERS) {
            assertThat(DiscountRules.tier(tier)).isEqualTo(tier);
        }
        assertThatThrownBy(() -> DiscountRules.tier("PRO"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("会员等级只能是");
    }

    @Test
    void 等级范围空即不限_顺序保留() {
        assertThat(DiscountRules.tierScope(List.of())).isNull();
        assertThat(DiscountRules.tierScope(List.of("pro", "max"))).containsExactly("pro", "max");
        assertThatThrownBy(() -> DiscountRules.tierScope(List.of("vip")))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void 状态不填走默认值_填了必须在取值内() {
        assertThat(DiscountRules.memberStatus(null)).isEqualTo("enabled");
        assertThat(DiscountRules.promotionStatus("  ")).isEqualTo("draft");
        assertThatThrownBy(() -> DiscountRules.memberStatus("paused"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("状态只能是");
    }


    @Test
    void 时间窗必须严格递增_区间是左闭右开() {
        LocalDateTime start = LocalDateTime.of(2026, 9, 25, 0, 0);
        DiscountRules.window(start, start.plusHours(1));

        assertThatThrownBy(() -> DiscountRules.window(start, start))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("结束时间必须晚于起始时间");
    }

    @Test
    void 每日时段只填一半会被拒_那在计价侧等于全天() {
        assertThatThrownBy(() -> DiscountRules.dailyWindow(LocalTime.of(22, 0), null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("要么都填");
        assertThatThrownBy(() -> DiscountRules.dailyWindow(null, LocalTime.of(6, 0)))
                .isInstanceOf(IllegalArgumentException.class);
        DiscountRules.dailyWindow(null, null);
    }

    @Test
    void 生效星期限在一到七_去重并升序() {
        assertThat(DiscountRules.daysOfWeek(List.of(5, 1, 5))).containsExactly(1, 5);
        assertThat(DiscountRules.daysOfWeek(List.of())).isNull();
        assertThatThrownBy(() -> DiscountRules.daysOfWeek(List.of(0)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("1（周一）");
        assertThatThrownBy(() -> DiscountRules.daysOfWeek(List.of(8)))
                .isInstanceOf(IllegalArgumentException.class);
    }


    @Test
    void 活动标识限死可读字符集() {
        assertThat(DiscountRules.code("night-70_2")).isEqualTo("night-70_2");
        assertThatThrownBy(() -> DiscountRules.code("Night70"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("活动标识只能用");
        assertThatThrownBy(() -> DiscountRules.code("夜间7折"))
                .isInstanceOf(IllegalArgumentException.class);
    }


    @Test
    void 集合写成JSON列_空集合写成NULL() {
        assertThat(DiscountRules.toJson(List.of("a", "*"))).isEqualTo("[\"a\",\"*\"]");
        assertThat(DiscountRules.toJson(List.of(1, 7))).isEqualTo("[1,7]");
        assertThat(DiscountRules.toJson(List.of())).isNull();
        assertThat(DiscountRules.toJson(null)).isNull();
    }
}
