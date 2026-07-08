package com.bluewhale.agent;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * 后端服务启动类。
 *
 * <p>单服务脚手架，启动类仅保留 {@code @SpringBootApplication}；{@code @MapperScan} 集中在
 * {@code config.MybatisPlusConfig}，扫描 {@code com.bluewhale.**.mapper}。
 */
@SpringBootApplication
public class AgentApplication {

    public static void main(String[] args) {
        SpringApplication.run(AgentApplication.class, args);
    }
}
