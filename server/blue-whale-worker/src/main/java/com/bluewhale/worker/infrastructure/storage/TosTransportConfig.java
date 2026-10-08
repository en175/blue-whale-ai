package com.bluewhale.worker.infrastructure.storage;

import com.volcengine.tos.transport.TransportConfig;

import java.util.function.Function;

public final class TosTransportConfig {

    static final int DEFAULT_CONNECT_TIMEOUT_MS = 30_000;

    static final int DEFAULT_READ_TIMEOUT_MS = 300_000;

    static final int DEFAULT_WRITE_TIMEOUT_MS = 300_000;

    private TosTransportConfig() {
    }

    public static TransportConfig fromEnv() {
        return from(System::getenv);
    }

    static TransportConfig from(Function<String, String> env) {
        TransportConfig config = new TransportConfig();
        config.setConnectTimeoutMills(readMillis(env, "TOS_CONNECT_TIMEOUT_MS", DEFAULT_CONNECT_TIMEOUT_MS));
        config.setReadTimeoutMills(readMillis(env, "TOS_READ_TIMEOUT_MS", DEFAULT_READ_TIMEOUT_MS));
        config.setWriteTimeoutMills(readMillis(env, "TOS_WRITE_TIMEOUT_MS", DEFAULT_WRITE_TIMEOUT_MS));
        return config;
    }

    private static int readMillis(Function<String, String> env, String name, int fallback) {
        String raw = env.apply(name);
        if (raw == null || raw.isBlank()) {
            return fallback;
        }
        int value;
        try {
            value = Integer.parseInt(raw.trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(name + " 必须是毫秒整数: " + raw);
        }
        if (value <= 0) {
            throw new IllegalArgumentException(name + " 必须为正数: " + raw);
        }
        return value;
    }
}
