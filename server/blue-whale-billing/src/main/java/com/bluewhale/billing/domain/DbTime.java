package com.bluewhale.billing.domain;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;

public final class DbTime {

    public static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");

    private DbTime() {
    }

    public static LocalDateTime toDb(Instant instant) {
        return instant == null ? null : LocalDateTime.ofInstant(instant, ZONE);
    }

    public static Instant fromDb(LocalDateTime localDateTime) {
        return localDateTime == null ? null : localDateTime.atZone(ZONE).toInstant();
    }
}
