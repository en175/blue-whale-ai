package com.bluewhale.billing.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 定时任务的装配（目前三条：{@code ReservationSweeper} / {@code LedgerSelfCheck} /
 * {@code CreditExpirySweeper}）。
 *
 * <h2>为什么 {@code @EnableScheduling} 单独一个类，而不是挂在启动类上</h2>
 *
 * 它一旦打开，**全应用**的 {@code @Scheduled} 都会开始跑。挂在
 * {@code BillingApplication} 上，加定时任务就变成「随手加个注解」——
 * 而定时任务往往带着「扫全表」「改状态」这类副作用。放在这里，
 * 「谁需要定时、为什么」有一个明确的落点，评审时也看得见。
 *
 * <h2>定时任务不在扣费路径上</h2>
 *
 * 它们跑在 Spring 自己的调度线程上（{@code spring.task.scheduling.pool.size} 见
 * application.yml：默认 1 个线程会让「一条慢任务卡住另一条」，
 * 而对账里正好有一条全表聚合），与 Hold 的 < 5ms 事务预算没有任何交集。
 *
 * <p>⚠️ 测试里这套仍然注册（构造期就会解析 cron / duration 字符串，
 * 写错的表达式在测试上下文启动时就炸，而不是等到线上凌晨 3 点），
 * 但 {@code src/test/resources/application.properties} 把首次执行推迟到 24 小时后——
 * 否则后台线程会去动共享测试库，测试之间就互相干扰了。
 */
@Configuration
@EnableScheduling
public class SchedulingConfig {
}
