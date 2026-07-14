package com.blue.whale.agent.config;

import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.json.JsonMapper;
import org.springframework.context.annotation.Configuration;

/**
 * 让 MyBatis-Plus 的 {@link JacksonTypeHandler} 用独立的 SNAKE_CASE ObjectMapper。
 *
 * <p>HTTP 对外 JSON 已回默认 camelCase（见 application.yml 注释，合规 CLAUDE.md）；
 * DB 的 JSON 列（{@code api_value}/{@code quantity_max}/{@code reference_image}/{@code input} 等）
 * 仍是 snake_case，这里给 JacksonTypeHandler 注入一个独立的 SNAKE_CASE ObjectMapper 做
 * snake↔camel 双向映射，与 Spring 容器的 ObjectMapper（管 HTTP，camelCase）隔离，互不污染。
 * 在容器构造时静态注入，早于任何 Mapper 查询，保证生效时序。
 *
 * <p>历史：曾复用 Spring 的 ObjectMapper（当时全局配 SNAKE_CASE）；去掉全局 SNAKE_CASE 后改为
 * 独立构造，见 ADR-0019。
 */
@Configuration
public class MybatisJacksonConfig {

    public MybatisJacksonConfig() {
        ObjectMapper dbMapper = JsonMapper.builder()
                .propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
                .build();
        JacksonTypeHandler.setObjectMapper(dbMapper);
    }
}
