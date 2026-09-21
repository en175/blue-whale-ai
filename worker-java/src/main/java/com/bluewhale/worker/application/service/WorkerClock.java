package com.bluewhale.worker.application.service;

import java.time.LocalDateTime;
import java.time.ZoneOffset;

/**
 * worker 的唯一时钟来源（IKHJ0Q）。
 *
 * <h2>为什么必须是单一入口</h2>
 * 本模块写进库的时间列全是 {@code DATETIME}，而 MySQL/MariaDB 的 {@code DATETIME} <b>不做时区换算</b>——
 * 存的就是字面量，读出来还是那个字面量。所以「库里看到的时间是北京时间」这件事，只能靠写入端把
 * 字面量算成北京时间。全模块 20 余处「当前时刻」原本各自写 {@code LocalDateTime.now(ZoneOffset.UTC)}，
 * 散落在 5 个类里、还有两份重复的 {@code nowUtc()} 私有副本——漏改一处就是那一列悄悄差 8 小时，
 * 而症状（{@code lease_expires_at < NOW()} 全线误判）离现场很远。收敛成一个常量之后，
 * 口径只此一处可改，也只在 {@code WorkerClockTest} 一处需要钉。
 *
 * <h2>为什么固定偏移、不用 ZoneId.of("Asia/Shanghai")</h2>
 * 亚洲/上海自 1991 年起不再实行夏令时，{@code +08:00} 是恒定的。用固定偏移表达的是
 * 「这是一个不会随 tzdata 版本漂移的算术常量」，而非「一台配置了某个时区的机器」——
 * 后者才会随容器环境变化，正是要避免的那类不确定性。
 *
 * <h2>与其它两处口径的关系（缺一不可）</h2>
 * <ul>
 *   <li><b>本类</b>：Java 写入的每一项时刻字面量（租约、退避、轮询、事件时间）。</li>
 *   <li><b>{@code DataSourceConfig}</b>：会话时区 {@code +08:00}，管 DB 端求值
 *       （{@code NOW()}、{@code CURRENT_TIMESTAMP(0)}、DDL 的 {@code DEFAULT CURRENT_TIMESTAMP(0)}）。</li>
 *   <li><b>Node 侧</b>：{@code db.ts} 的 {@code timezone} + {@code @prisma/adapter-mariadb} 的补丁。</li>
 * </ul>
 * 三者必须同批次上线：只改一半会让「Java 写的时间」与「SQL 里 {@code NOW()} 算的时间」差 8 小时，
 * 而本模块所有到期判断都在 SQL 里对 {@code NOW()}（{@code next_action_at <= NOW()}、
 * {@code lease_expires_at < NOW()}），表现为任务被立刻重复认领或永远不被重投。
 */
public final class WorkerClock {

    /** 北京时间固定偏移。无夏令时，是恒定算术量。 */
    public static final ZoneOffset BEIJING = ZoneOffset.ofHours(8);

    private WorkerClock() {
    }

    /** 当前时刻，按北京时间墙钟。模块内所有「现在」都走这里。 */
    public static LocalDateTime now() {
        return LocalDateTime.now(BEIJING);
    }
}
