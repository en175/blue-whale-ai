package com.bluewhale.common.http;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import java.util.concurrent.TimeUnit;

public final class NewApiHttpSupport {

    private NewApiHttpSupport() {}

    private static final OkHttpClient SHARED = new OkHttpClient.Builder().build();

    public static final String BASE_URL_MISSING_MSG = "NEW_API_BASE_URL 未配置";

    public static String normalizeBaseUrl(String baseUrl) {
        if (baseUrl == null || baseUrl.isBlank()) {
            throw new IllegalStateException(BASE_URL_MISSING_MSG);
        }
        return baseUrl.replaceAll("/+$", "");
    }

    public static OkHttpClient buildClient(long connectMs, long readMs, long writeMs) {
        return SHARED.newBuilder()
                .connectTimeout(connectMs, TimeUnit.MILLISECONDS)
                .readTimeout(readMs, TimeUnit.MILLISECONDS)
                .writeTimeout(writeMs, TimeUnit.MILLISECONDS)
                .build();
    }

    public static void applyStandardHeaders(Request.Builder b, String bearerToken, String traceId) {
        b.header("Authorization", "Bearer " + bearerToken)
                .header("X-Trace-Id", traceId)
                .header("X-Client-System", "bluewhale");
    }

    public interface HttpStatusCarrier {
        int getStatus();
    }

    public static Integer upstreamHttpStatus(Throwable error) {
        for (Throwable cause = error.getCause(); cause != null; cause = cause.getCause()) {
            if (cause instanceof HttpStatusCarrier http) {
                return http.getStatus();
            }
        }
        return null;
    }
}
