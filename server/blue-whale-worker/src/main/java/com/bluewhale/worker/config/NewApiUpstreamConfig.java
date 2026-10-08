package com.bluewhale.worker.config;

import com.bluewhale.common.http.NewApiHttpSupport;
import com.bluewhale.worker.infrastructure.mapper.SystemSettingMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
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

    @Bean
    public UpstreamCredential newApiUpstreamCredential(
            SystemSettingMapper systemSettingMapper, Environment env) {
        String secret = env.getProperty(SystemSettingEnvelope.SECRET_ENV);
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException(
                    SystemSettingEnvelope.SECRET_ENV + " 未配置：读不出 system_settings 里的上游凭证"
                            + "（主密钥必须与数据库分开存放；缺它时拒读，不降级成明文）");
        }
        return new UpstreamCredential(systemSettingMapper, secret.trim());
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
     * 上游统一 key 的**读点**（不是一个值——值是随时可改的配置）。
     * <p>
     * 刻意不做成 record：值一旦 record 化，就会有调用方把它当常量缓存下来，「改了配置不生效」
     * 又回来了。{@link #requireKey()} **每次调用都现查库**：素材跟进一轮一次、5s 一轮，
     * 这点开销相对一次上游 HTTP 调用是噪声，换到的是「管理端改完在一轮内生效」。
     */
    public static final class UpstreamCredential {

        /** `system_settings` 里上游模块的行键（与 TS 侧 {@code KEY_UPSTREAM} 同值）。 */
        public static final String SETTING_KEY = "upstream";

        /** 模块 JSON 里的字段名（与 TS 侧 {@code UPSTREAM_FIELDS} 同值）。 */
        public static final String FIELD_NEW_API_KEY = "new_api_key";

        private static final ObjectMapper JSON = new ObjectMapper();

        private final SystemSettingMapper systemSettingMapper;
        private final String secret;

        public UpstreamCredential(SystemSettingMapper systemSettingMapper, String secret) {
            this.systemSettingMapper = systemSettingMapper;
            this.secret = secret;
        }

        /**
         * 取**当前**配置的项目统一 key。
         *
         * @throws IllegalStateException 未配置 / 读不出来 / 解不开。**绝不返回空串**：
         *         空串打上游的表现是 {@code Authorization: Bearer }，上游回 401，
         *         报错点离原因（管理端没配）很远。
         */
        public String requireKey() {
            String envelope = systemSettingMapper.selectValue(SETTING_KEY);
            if (envelope == null || envelope.isBlank()) {
                throw new IllegalStateException(
                        "上游凭证未配置：请在管理端「系统设置 → 上游凭证」填入 new-api 的项目统一 key");
            }
            String json = SystemSettingEnvelope.open(envelope, secret);
            String key;
            try {
                key = JSON.readTree(json).path(FIELD_NEW_API_KEY).asText("");
            } catch (Exception e) {
                throw new IllegalStateException(
                        "上游凭证不是合法的 JSON 对象，请人工核对：" + e.getMessage(), e);
            }
            if (key.isBlank()) {
                throw new IllegalStateException(
                        "上游凭证为空：请在管理端「系统设置 → 上游凭证」填入 new-api 的项目统一 key");
            }
            return key.trim();
        }
    }
}
