package com.bluewhale.common.http;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import java.util.concurrent.TimeUnit;

/**
 * new-api 三路客户端共享 HTTP 装配（刀③ 去重）。
 * <p>
 * 覆盖三处跨客户端重复：baseUrl 校验/去尾斜杠、OkHttpClient 超时构建、标准请求头三元组
 * （Authorization: Bearer / X-Trace-Id / X-Client-System: bluewhale，契约 §5 + ADR-0080）；
 * 另收敛全族共用的上游 HTTP 状态静态解析（{@link #upstreamHttpStatus}，IKIMN8）。
 * <p>
 * 变化轴：网关接入点（image / video / audio 各自超时不同——保留各客户端独立取值，不在此塌缩）。
 * <p>
 * <b>传输层单点</b>：所有客户端实例都从 {@link #SHARED} 派生（见 {@link #buildClient}），
 * 全进程只有一个连接池与一个调度线程池打同一个上游。
 */
public final class NewApiHttpSupport {

    private NewApiHttpSupport() {}

    /**
     * 全进程共享的 OkHttp 原型：**只有它持有连接池与调度线程池**，各族 client 从它派生。
     * <p>
     * ⚠️ 为什么收敛成一份：收敛前每个客户端实例各 {@code new OkHttpClient.Builder()}
     * （本进程 32 个实例），就是 32 套互不相干的连接池与线程池同时打同一个网关——连接无法
     * 复用，池的上限也不受任何单点控制。OkHttp 官方口径也是「共享一个 client，
     * 需要不同配置就 newBuilder()」。
     * <p>
     * ⚠️ 为什么这样派生**不会**把各族超时抹平：{@code newBuilder()} 复制的是**引用**——
     * 派生实例与原型的 {@code connectionPool} / {@code dispatcher} 是同一个对象，而
     * connect / read / write 超时是**每个实例各自**的字段。于是「共用一个上游」与
     * 「各族超时不同」同时成立：收敛的是池，不是超时。
     * <p>
     * 原型自身的超时值无关紧要（没有任何调用直接用它，派生实例一律显式覆盖三个超时）。
     */
    private static final OkHttpClient SHARED = new OkHttpClient.Builder().build();

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

    /**
     * 从共享原型派生一个族专用 OkHttpClient（超时毫秒）。
     * <p>
     * 派生实例复用原型的连接池与线程池，只有超时是它自己的——各族读/写超时（以及它们与
     * claim 租约的余量关系）留在各自客户端，此处不塌缩成一个值。
     */
    public static OkHttpClient buildClient(long connectMs, long readMs, long writeMs) {
        return SHARED.newBuilder()
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

    /**
     * 上游网关异常携带 HTTP 状态的最小契约（IKIMN8 / IKIMS2）。
     * <p>
     * 为什么不是直接 instanceof worker 的具体异常：本类已上移到共享模块 `blue-whale-common`，
     * 而 worker 依赖本模块（反向依赖编译不过），故这里只钉契约；唯一实现是 worker 侧的
     * {@code NewApiVideoClient.HttpStatusException}——网关 !2xx 抛错时以它为 cause 携带状态
     * （唯一事实源，网关异常形态不变）。
     */
    public interface HttpStatusCarrier {
        int getStatus();
    }

    /**
     * 沿 cause 链解析上游 HTTP 状态：网关 !2xx 抛错时以
     * {@link HttpStatusCarrier} cause 携带状态（唯一事实源，网关异常形态不变）。
     * <p>
     * 返回 {@code null} = 非 HTTP 失败（超时 / 连接失败 / 业务信封失败等链上无该 cause）或无
     * cause——调用方据此不写 error.details 的 http_status 键（IKIMN8 / IKIMS2，起源于
     * IKIHGQ audio_mix 的内联实现收口共享）。
     */
    public static Integer upstreamHttpStatus(Throwable error) {
        for (Throwable cause = error.getCause(); cause != null; cause = cause.getCause()) {
            if (cause instanceof HttpStatusCarrier http) {
                return http.getStatus();
            }
        }
        return null;
    }
}
