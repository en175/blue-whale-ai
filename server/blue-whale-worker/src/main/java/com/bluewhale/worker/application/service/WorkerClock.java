package com.bluewhale.worker.application.service;

import java.time.LocalDateTime;
import java.time.ZoneOffset;

public final class WorkerClock {

    public static final ZoneOffset BEIJING = ZoneOffset.ofHours(8);

    private WorkerClock() {
    }

    public static LocalDateTime now() {
        return LocalDateTime.now(BEIJING);
    }
}
