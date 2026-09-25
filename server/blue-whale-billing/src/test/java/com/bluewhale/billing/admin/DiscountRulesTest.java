package com.bluewhale.billing.admin;

import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 折扣写入校验的单元测试（不连库，{@link DiscountRules} 是纯函数）。
 *
 * <p>这些规则的价值全在**拒绝**上：写错一个 {@code discount_bp}（0.9 当成万分比）就是白送，
 * 写错一个 {@code model_ids}（空数组 = 不限）就是全站打折。所以每条拒绝都要有用例，
 * 且**断言的是文案** —— 文案就是运营看到的东西，它退化成「参数错误」等于没校验。
 */
class DiscountRulesTest {

    // ─────────────────────────────────────────────────────────────
    // 折扣系数
    // ─────────────────────────────────────────────────────────────

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

    // ─────────────────────────────────────────────────────────────
    // 模式（与 discount/Patterns 的实现严格对齐）
    // ─────────────────────────────────────────────────────────────

    @Test
    void 模式认全匹配_前缀_精确三种形态() {
        assertThat(DiscountRules.pattern("*", 128, "模型匹配")).isEqualTo("*");
        assertThat(DiscountRules.pattern("Seedance-*", 128, "模型匹配")).isEqualTo("seedance-*");
        assertThat(DiscountRules.pattern(" gpt-4o ", 128, "模型匹配")).isEqualTo("gpt-4o");
    }

    @Test
    void 中间带星号的模式被拒_计价侧匹配不到任何东西() {
        // 它比配错更坏：规则永不生效，而界面上看起来好好的
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
        // 界面上的空行不该被当成一个模式
        assertThat(DiscountRules.patterns(List.of(" ", ""), 64, "任务类型范围", false)).isNull();
    }

    @Test
    void 必填的模式集合不能为空_活动必须显式写模型范围() {
        // 空等于「全部模型打折」—— 一个限时活动把全站打折几乎不会是本意
        assertThatThrownBy(() -> DiscountRules.patterns(List.of(), 128, "模型范围", true))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("必填");
    }

    @Test
    void 模式集合去重且保留填写顺序() {
        assertThat(DiscountRules.patterns(List.of("A", "b", "a"), 128, "模型范围", true))
                .containsExactly("a", "b");
    }

    // ─────────────────────────────────────────────────────────────
    // 枚举
    // ─────────────────────────────────────────────────────────────

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

    // ─────────────────────────────────────────────────────────────
    // 时间
    // ─────────────────────────────────────────────────────────────

    @Test
    void 时区真的解析一次_不是看它非空就放行() {
        assertThat(DiscountRules.timezone("Asia/Shanghai")).isEqualTo("Asia/Shanghai");
        // 计价侧 ZoneId.of(row.tz) 在预扣路径上抛异常 —— 一个拼错的时区名会把配置错误变成线上故障
        assertThatThrownBy(() -> DiscountRules.timezone("Asia/Shangahi"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("时区名不合法");
        assertThatThrownBy(() -> DiscountRules.timezone(null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("时区必填");
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
        // 填报的人以为自己限定了时段，实际拿到一条全天折扣
        assertThatThrownBy(() -> DiscountRules.dailyWindow(LocalTime.of(22, 0), null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("要么都填");
        assertThatThrownBy(() -> DiscountRules.dailyWindow(null, LocalTime.of(6, 0)))
                .isInstanceOf(IllegalArgumentException.class);
        // 都留空 = 全天，合法
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

    // ─────────────────────────────────────────────────────────────
    // 活动标识
    // ─────────────────────────────────────────────────────────────

    @Test
    void 活动标识限死可读字符集() {
        assertThat(DiscountRules.code("night-70_2")).isEqualTo("night-70_2");
        // 它是审计/排查时用来在日志里定位这条活动的，大写与中文会让它对不上
        assertThatThrownBy(() -> DiscountRules.code("Night70"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("活动标识只能用");
        assertThatThrownBy(() -> DiscountRules.code("夜间7折"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    // ─────────────────────────────────────────────────────────────
    // JSON 列
    // ─────────────────────────────────────────────────────────────

    @Test
    void 集合写成JSON列_空集合写成NULL() {
        assertThat(DiscountRules.toJson(List.of("a", "*"))).isEqualTo("[\"a\",\"*\"]");
        assertThat(DiscountRules.toJson(List.of(1, 7))).isEqualTo("[1,7]");
        assertThat(DiscountRules.toJson(List.of())).isNull();
        assertThat(DiscountRules.toJson(null)).isNull();
    }
}
