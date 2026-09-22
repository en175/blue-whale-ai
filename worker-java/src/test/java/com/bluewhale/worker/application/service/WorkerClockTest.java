package com.bluewhale.worker.application.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 时钟口径的唯一钉点（IKHJ0Q）。
 *
 * <p>本模块所有「现在」都经 {@link WorkerClock#now()}，而它写出的字面量直接落进 DATETIME 列
 * （MySQL 的 DATETIME 不做时区换算）。所以偏移一旦改错，症状不是这里报错，而是几小时之外
 * 的租约误判——那些测试（{@code JobStateMachineMySqlIntegrationTest} 等）用的是相对断言，
 * 换错钟也可能照样绿。这里把偏移本身钉死，让「改偏移」必须是一次显式编辑。
 */
class WorkerClockTest {

    @Test
    @DisplayName("now() 是北京时间墙钟，比同一瞬时的 UTC 墙钟大 8 小时")
    void nowIsBeijingWallClock() {
        // LocalDateTime 不带偏移（getOffset 在 OffsetDateTime 上），所以用「两个墙钟之差」来判定：
        // 同一瞬时下，北京墙钟 − UTC 墙钟 = 8 小时。
        LocalDateTime utcWallClock = LocalDateTime.now(ZoneOffset.UTC);
        LocalDateTime beijingWallClock = WorkerClock.now();
        long minutesApart = Duration.between(utcWallClock, beijingWallClock).toMinutes();

        // 防退化：WorkerClock 若被改回 UTC，这里差值约为 0（采样误差在秒级），必然红。
        assertThat(minutesApart).isBetween(479L, 480L);
    }

    @Test
    @DisplayName("now() 与真实当前时刻同瞬时，误差在秒级")
    void nowTracksRealTime() {
        LocalDateTime before = LocalDateTime.now(ZoneOffset.ofHours(8));
        LocalDateTime actual = WorkerClock.now();
        LocalDateTime after = LocalDateTime.now(ZoneOffset.ofHours(8));

        assertThat(actual).isAfterOrEqualTo(before);
        assertThat(actual).isBeforeOrEqualTo(after);
        assertThat(Duration.between(before, actual).abs()).isLessThan(Duration.ofSeconds(5));
    }

    @Test
    @DisplayName("BEIJING 是无夏令时的固定偏移——不随 tzdata 漂移")
    void beijingIsAFixedOffset() {
        // 亚洲/上海自 1991 年起不再实行夏令时；固定偏移表达的是「算术常量」，不是「一台机器」。
        // 冬夏各取一个时刻，偏移必须相同。
        assertThat(WorkerClock.BEIJING.getTotalSeconds()).isEqualTo(8 * 3600);
        assertThat(LocalDateTime.of(2026, 1, 15, 12, 0).atOffset(WorkerClock.BEIJING).getOffset())
                .isEqualTo(LocalDateTime.of(2026, 7, 15, 12, 0).atOffset(WorkerClock.BEIJING).getOffset());
    }
}
