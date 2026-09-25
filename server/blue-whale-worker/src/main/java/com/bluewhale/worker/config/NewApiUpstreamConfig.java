package com.bluewhale.worker.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 上游（new-api）调用凭证：**项目级统一 key**（ADR-0114）。
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
@Configuration
public class NewApiUpstreamConfig {

    /** 环境变量名与 TS 侧 ({@code libs/shared/account/upstream-credential.ts}) 同值。 */
    public static final String ENV_UPSTREAM_KEY = "NEW_API_UPSTREAM_KEY";

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
