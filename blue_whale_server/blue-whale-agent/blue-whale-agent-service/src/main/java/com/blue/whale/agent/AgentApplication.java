package com.blue.whale.agent;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;

/**
 * AgentApplication
 *
 * @author: Jiyeon2__
 * date: 2024/9/27
 * description: Agent服务启动类
 */
@SpringBootApplication
@MapperScan("com.blue.whale.agent.**.mapper")
@EnableDiscoveryClient
public class AgentApplication {

    public static void main(String[] args) {
        SpringApplication.run(AgentApplication.class, args);
    }
}
