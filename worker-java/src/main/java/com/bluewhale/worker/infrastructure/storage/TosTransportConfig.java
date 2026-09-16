package com.bluewhale.worker.infrastructure.storage;

import com.volcengine.tos.transport.TransportConfig;

import java.util.function.Function;

/**
 * TOS SDK 传输层超时配置（IKFS5W）。
 * <p>
 * SDK 默认 read/write 超时 30s。该值是**单次读空闲**上限（OkHttp 语义：多久没有新字节算超时，
 * 不是整段传输的总时长），所以慢速但持续推进的下载不会触发；真正会触发的是网络抖动导致的
 * 停顿——30s 太短，任务直接判 {@code video_download_failed}（实例：media_extract job 1848，
 * 586KB 源视频下载中途报 timeout）。这里放宽默认值并支持 env 覆盖。
 * <p>
 * ⚠️ 读超时大于任务租约（120s）时，下载必须持续续租：{@link TosMediaStorage#download} 会按
 * 心跳回调续租，调用方（MediaExtractJobProcessor）把心跳接到进度上报上。
 * <p>
 * env：{@code TOS_CONNECT_TIMEOUT_MS} / {@code TOS_READ_TIMEOUT_MS} / {@code TOS_WRITE_TIMEOUT_MS}（毫秒，正整数）。
 */
public final class TosTransportConfig {

    /** 建链超时：30s（SDK 默认 10s，跨境/弱网建链偏紧）。 */
    static final int DEFAULT_CONNECT_TIMEOUT_MS = 30_000;

    /** 读空闲超时：5min（SDK 默认 30s，网络抖动即判失败）。 */
    static final int DEFAULT_READ_TIMEOUT_MS = 300_000;

    /** 写超时：5min（上传音频/图片产物，SDK 默认 30s）。 */
    static final int DEFAULT_WRITE_TIMEOUT_MS = 300_000;

    private TosTransportConfig() {
    }

    /** 从进程环境读取超时配置，未设置走默认值。 */
    public static TransportConfig fromEnv() {
        return from(System::getenv);
    }

    /** 测试注入口：env 读取函数可替换（与 {@link System#getenv(String)} 同语义）。 */
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
