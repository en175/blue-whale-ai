package com.bluewhale.billing.domain;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;

/**
 * 数据库时间的换算 —— **全模块唯一一处**「Instant ↔ DATETIME」的口径。
 *
 * <h2>为什么需要一个类专门做这件事</h2>
 *
 * 表里存的是无时区的 {@code DATETIME}，而 SQL 里又在用服务端的 {@code NOW()} 做比较
 * （批次是否过期）。这两者只有在**写入时的墙钟口径 == 会话时区**时才可比。
 * 一旦不一致，偏差就是整小时的（典型是 8 小时）——而它不会报错，
 * 表现为「积分到期后还能多用 8 小时」这种没人会当场发现的钱漏。
 *
 * <p>所以口径必须钉在一处：**统一用北京时间**（对齐 ADR-0111 的北京时间口径），
 * 并由 datasource 的 {@code forceConnectionTimeZoneToSession} 把 MySQL 会话时区
 * 也钉成同一个值。改这里就要同时改那里——两边不一致，比较就是错的。
 */
public final class DbTime {

    /** 数据库墙钟口径。必须与 datasource URL 的 connectionTimeZone 一致。 */
    public static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");

    private DbTime() {
    }

    /** 写入用：瞬时 → 库内墙钟。null 透传（{@code expires_at} 的 NULL = 永久）。 */
    public static LocalDateTime toDb(Instant instant) {
        return instant == null ? null : LocalDateTime.ofInstant(instant, ZONE);
    }

    /** 读取用：库内墙钟 → 瞬时。 */
    public static Instant fromDb(LocalDateTime localDateTime) {
        return localDateTime == null ? null : localDateTime.atZone(ZONE).toInstant();
    }
}
