package com.bluewhale.agent.config;

import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Configuration;

/**
 * 让 MyBatis-Plus 的 {@link JacksonTypeHandler} 复用 Spring 容器的 {@link ObjectMapper}。
 *
 * <p>JacksonTypeHandler 默认用自带的静态 ObjectMapper（无命名策略、未知字段即报错），
 * 而 DB 中 JSON 列用 snake_case（如 {@code api_value}、{@code quantity_max}、{@code reference_image}），
 * 反序列化到实体的 camelCase 字段（{@code apiValue} 等）会因“Unrecognized field”抛
 * {@code UnrecognizedPropertyException}，最终被全局异常处理器兜底。
 *
 * <p>Spring 的 ObjectMapper 已按 {@code spring.jackson.property-naming-strategy=SNAKE_CASE}
 * 配置（见 application-dev.yml），复用即可统一 snake↔camel 双向映射，HTTP 与 DB 的 JSON 行为一致。
 * 在容器构造时静态注入，早于任何 Mapper 查询，保证生效时序。
 */
@Configuration
public class MybatisJacksonConfig {

    public MybatisJacksonConfig(ObjectMapper objectMapper) {
        JacksonTypeHandler.setObjectMapper(objectMapper);
    }
}
