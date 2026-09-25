package com.bluewhale.worker.config;

import com.bluewhale.common.http.NewApiHttpSupport;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

/**
 * 上游（new-api）部署配置的**唯一读取点**：地址 + 调用凭证 + 各族超时常量解析。
 * <p>
 * 「new-api 从哪进来」在这个进程里只有一个答案（ADR-0114 决策 7 的 Java 侧落点：TS 侧同一
 * 收敛在 {@code libs/shared/upstream/new-api-egress.ts}）。收敛前 {@code NEW_API_BASE_URL}
 * 被 18 处各读各的（17 个客户端类各自 {@code System.getenv}，外加装配处一次属性读取），
 * 于是地址来源没有单点：改一处不影响另一处，缺配置时的表现也各不相同。
 * <p>
 * 出口**管**地址解析（未配置即抛，不返回空串）与超时常量解析；**刻意不管**两件事
 * （与 TS 出口同口径）：
 * <ul>
 *   <li><b>鉴权</b>：new-api 有两套并存的模型——用户面的 per-job 冻结 sk-（图片/视频/音频
 *       各 client 的调用入参）、项目级统一 key（{@link UpstreamCredential}）。塞进出口就得让
 *       出口分辨「这次是哪种调用」，那只是把分支换个地方。</li>
 *   <li><b>超时数值</b>：各族的超时是与 claim 租约对着调的（见各族 {@code loadTimeoutMs()} 的
 *       javadoc），不能塌缩成一个值。此处只统一**解析方式**，不统一数值。</li>
 * </ul>
 * <p>
 * 缺配置时在 bean 装配期抛 {@link IllegalStateException} 终止启动——与
 * {@link DataSourceConfig#dataSource()} 缺 {@code DATABASE_URL}、{@link RocketMqConfig}
 * 缺 {@code ROCKETMQ_ENDPOINTS} 同一姿势（ADR-0084 决策 2：MQ / DB / 上游网关 / TOS
 * 四套配置齐备才允许启动）。
 */
@Configuration
public class NewApiUpstreamConfig {

    private static final Logger log = LoggerFactory.getLogger(NewApiUpstreamConfig.class);

    /** 环境变量名与 TS 侧 ({@code libs/shared/account/upstream-credential.ts}) 同值。 */
    public static final String ENV_UPSTREAM_KEY = "NEW_API_UPSTREAM_KEY";

    /** 上游网关地址的环境变量名（与 TS 侧 {@code NEW_API_BASE_URL_ENV} 同值）。 */
    public static final String ENV_BASE_URL = "NEW_API_BASE_URL";

    /**
     * 上游网关地址。
     * <p>
     * 走 Spring 属性源而不是裸 {@code System.getenv}：部署语义不变（systemEnvironment 本就是
     * 默认属性源之一），但装配期测试能用属性注入喂它——{@code System.getenv} 喂不到，
     * 缺配置路径就只能「本机恰好没设变量」时才可复现（{@code StartupContractTest} 的口径）。
     * <p>
     * 这里只做「取出来」：非空守卫在 {@link UpstreamBaseUrl} 自己的构造器里，于是无论谁、
     * 从哪条路径拿到地址，都过同一道关。
     */
    @Bean
    public UpstreamBaseUrl newApiBaseUrl(Environment env) {
        return new UpstreamBaseUrl(env.getProperty(ENV_BASE_URL));
    }

    /**
     * 上游统一 key：**项目级**（ADR-0114）。
     * <p>
     * new-api 从「我们的用户体系」降级为「带一把统一 key 的上游供应商」后，调用它的凭证不再是
     * 某个用户登录的产物，而是**部署配置**——与 {@code NEW_API_BASE_URL} 同级，全进程一份。
     * <p>
     * 谁在用：{@code MaterialStatusPoller}。定时跟进发生在任何 job 之外（那些走
     * {@code job.input.provider_credential} 的进程内冻结值），没有 job 可借、也没有会话可借，
     * 只能取这把部署注入的 key。
     * <p>
     * 缺配置时在 bean 装配期抛 {@link IllegalStateException} 终止启动——与
     * {@link DataSourceConfig#dataSource()} 缺 {@code DATABASE_URL}、{@link RocketMqConfig}
     * 缺 {@code ROCKETMQ_ENDPOINTS} 同一姿势。不允许「拿空串继续跑」：那样 5 个素材跟进循环会
     * 一直以 {@code Bearer } 打网关收 401，报错点离原因很远。
     */
    @Bean
    public UpstreamCredential newApiUpstreamCredential() {
        String key = System.getenv(ENV_UPSTREAM_KEY);
        if (key == null || key.isBlank()) {
            throw new IllegalStateException(
                    ENV_UPSTREAM_KEY + " 未配置：上游调用凭证无法解析");
        }
        return new UpstreamCredential(key.trim());
    }

    /**
     * 各族超时常量的**唯一解析点**：未设 / 非正 / 非法都回落到该族的默认值。
     * <p>
     * 解析方式（{@code System.getenv} + 正整数校验 + 失败回落 + 一条 debug）此前在 6 个
     * 客户端里逐字重复了 6 遍；环境变量名与默认值仍留在各族（见其 {@code loadTimeoutMs()}），
     * 因为那是与 claim 租约对着调出来的族特异值。
     *
     * @param envName    族的环境变量名（如 {@code NEW_API_IMAGE_TIMEOUT_MS}）
     * @param defaultMs  该族的默认超时（毫秒）
     */
    public static int timeoutMs(String envName, int defaultMs) {
        String raw = System.getenv(envName);
        if (raw != null) {
            try {
                int n = Integer.parseInt(raw);
                if (n > 0) return n;
            } catch (NumberFormatException e) {
                log.debug("{} 解析失败，使用默认值: {}", envName, e.getMessage());
            }
        }
        return defaultMs;
    }

    /**
     * 上游网关地址的可注入形态。
     * <p>
     * 用独立类型而不是裸 {@code String}（与 {@link UpstreamCredential} 同理由）：裸 String 的
     * bean 会与任何别的 String bean 争抢注入点，且「这是哪个地址」在构造函数签名里看不出来。
     * <p>
     * ⚠️ 非空是**类型自己的不变式**（构造器守卫），不靠装配处自觉：缺/空白在这里就抛
     * {@link NewApiHttpSupport#BASE_URL_MISSING_MSG}——与图片/视频/音频/素材四路客户端同口径，
     * 「缺配置即启动失败」（ADR-0084 决策 2），不允许存在「拿到空地址继续跑」的形态。
     */
    public record UpstreamBaseUrl(String value) {

        public UpstreamBaseUrl {
            if (value == null || value.isBlank()) {
                throw new IllegalStateException(NewApiHttpSupport.BASE_URL_MISSING_MSG);
            }
        }

        /** 拼路径用的地址：去尾斜杠（口径单源在 {@link NewApiHttpSupport#normalizeBaseUrl}）。 */
        public String normalized() {
            return NewApiHttpSupport.normalizeBaseUrl(value);
        }
    }

    /**
     * 上游统一 key 的可注入形态。
     * <p>
     * 用独立类型而不是裸 {@code String}：裸 String 的 bean 会与任何别的 String bean 争抢
     * 注入点，且「这是哪一把 key」在构造函数签名里看不出来。
     */
    public record UpstreamCredential(String key) {
        public UpstreamCredential {
            if (key == null || key.isBlank()) {
                throw new IllegalArgumentException("上游统一 key 不能为空");
            }
        }
    }
}
