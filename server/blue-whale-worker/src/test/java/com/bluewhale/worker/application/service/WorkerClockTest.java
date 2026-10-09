package com.bluewhale.worker.application.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;

class WorkerClockTest {

    @Test
    @DisplayName("now() 是北京时间墙钟，比同一瞬时的 UTC 墙钟大 8 小时")
    void nowIsBeijingWallClock() {
        LocalDateTime utcWallClock = LocalDateTime.now(ZoneOffset.UTC);
        LocalDateTime beijingWallClock = WorkerClock.now();
        long minutesApart = Duration.between(utcWallClock, beijingWallClock).toMinutes();

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
        assertThat(WorkerClock.BEIJING.getTotalSeconds()).isEqualTo(8 * 3600);
        assertThat(LocalDateTime.of(2026, 1, 15, 12, 0).atOffset(WorkerClock.BEIJING).getOffset())
                .isEqualTo(LocalDateTime.of(2026, 7, 15, 12, 0).atOffset(WorkerClock.BEIJING).getOffset());
    }
}
