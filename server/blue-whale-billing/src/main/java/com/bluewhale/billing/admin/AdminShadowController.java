package com.bluewhale.billing.admin;

import com.bluewhale.billing.application.SettlementService;
import com.bluewhale.billing.shadow.ShadowEntryRepository;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;

/**
 * 影子期的对账视图（《迁移与切换 runbook》§3.2）。
 *
 * <p>它就是 runbook 里那句「每日比对：我们算的 vs new-api 扣的，差异 &gt; 1% 就停下修定价」
 * 的操作界面。两个视图：
 * <ul>
 *   <li>{@code /summary} —— 算出的价 vs 上游扣用户的钱，以及**比了几条**</li>
 *   <li>{@code /unpriceable} —— 未配规则的 (model, task) 清单，按出现次数降序</li>
 * </ul>
 *
 * <p>⚠️ 与其它管理端接口一样**没有鉴权**，只在内网。
 */
@RestController
@RequestMapping("/admin/shadow")
@ConditionalOnProperty(name = "billing.admin.enabled", havingValue = "true")
public class AdminShadowController {

    /** 默认看最近 1 天——runbook 说的是「每日比对」。 */
    private static final int DEFAULT_WINDOW_DAYS = 1;

    private final ShadowEntryRepository shadowEntries;
    private final SettlementService settlement;

    public AdminShadowController(ShadowEntryRepository shadowEntries, SettlementService settlement) {
        this.shadowEntries = shadowEntries;
        this.settlement = settlement;
    }

    /**
     * 影子期总览。
     *
     * @param from ISO-8601 时刻；省略 = 最近 1 天
     */
    @GetMapping("/summary")
    public Map<String, Object> summary(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to) {

        Instant windowTo = to == null ? Instant.now() : to;
        Instant windowFrom = from == null ? windowTo.minus(DEFAULT_WINDOW_DAYS, ChronoUnit.DAYS) : from;

        Map<String, Object> stats = shadowEntries.summarize(windowFrom, windowTo);
        return Map.of(
                "from", windowFrom.toString(),
                "to", windowTo.toString(),
                // 影子模式开关也一并回显：看到一堆数据却不知道现在扣不扣钱，
                // 是最容易误判的时刻
                "shadowMode", settlement.isShadowMode(),
                "stats", stats);
    }

    /**
     * 未配规则的清单 —— **切换前要修掉的东西**。
     *
     * <p>按出现次数降序：先修最常被碰到的。这份清单为空，是切换的前置条件之一
     * （另见 §3.3 步骤 8 的 dry-run）。
     */
    @GetMapping("/unpriceable")
    public List<Map<String, Object>> unpriceable(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to) {

        Instant windowTo = to == null ? Instant.now() : to;
        Instant windowFrom = from == null ? windowTo.minus(DEFAULT_WINDOW_DAYS, ChronoUnit.DAYS) : from;
        return shadowEntries.unpriceableBreakdown(windowFrom, windowTo);
    }
}
