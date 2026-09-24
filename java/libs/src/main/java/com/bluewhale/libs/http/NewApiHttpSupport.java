package com.bluewhale.libs.http;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import java.util.concurrent.TimeUnit;

/**
 * new-api 三路客户端共享 HTTP 装配（刀③ 去重）。
 * <p>
 * 覆盖三处跨客户端重复：baseUrl 校验/去尾斜杠、OkHttpClient 超时构建、标准请求头三元组
 * （Authorization: Bearer / X-Trace-Id / X-Client-System: bluewhale，契约 §5 + ADR-0080）。
 * <p>
 * 变化轴：网关接入点（image / video / audio 各自超时不同——保留各客户端独立取值，不在此塌缩）。
 */
public final class NewApiHttpSupport {

    private NewApiHttpSupport() {}

    /** 网关必需环境变量缺失时的错误信息（三客户端原样沿用）。 */
    public static final String BASE_URL_MISSING_MSG = "NEW_API_BASE_URL 未配置";

    /**
     * 校验 + 归一化 baseUrl：非空才过，并剥掉末尾斜杠。
     * @throws IllegalStateException baseUrl 未配置
     */
    public static String normalizeBaseUrl(String baseUrl) {
        if (baseUrl == null || baseUrl.isBlank()) {
            throw new IllegalStateException(BASE_URL_MISSING_MSG);
        }
        return baseUrl.replaceAll("/+$", "");
    }

    /** 构建带 connect/read/write 超时的 OkHttpClient（毫秒）。 */
    public static OkHttpClient buildClient(long connectMs, long readMs, long writeMs) {
        return new OkHttpClient.Builder()
                .connectTimeout(connectMs, TimeUnit.MILLISECONDS)
                .readTimeout(readMs, TimeUnit.MILLISECONDS)
                .writeTimeout(writeMs, TimeUnit.MILLISECONDS)
                .build();
    }

    /**
     * 附加 new-api 标准请求头（契约 §5 / ADR-0080）。
     * <p>
     * Authorization: Bearer &lt;per-job 解封凭证&gt;；X-Trace-Id 请求追踪；
     * X-Client-System: bluewhale 白名单头（缺了网关登录隔离会破）。
     */
    public static void applyStandardHeaders(Request.Builder b, String bearerToken, String traceId) {
        b.header("Authorization", "Bearer " + bearerToken)
                .header("X-Trace-Id", traceId)
                .header("X-Client-System", "bluewhale");
    }
}
