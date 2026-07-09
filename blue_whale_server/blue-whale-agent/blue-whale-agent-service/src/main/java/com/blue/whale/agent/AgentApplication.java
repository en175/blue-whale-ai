package com.blue.whale.agent;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;

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

    /** 数据库主机 */
    private static final String DB_HOST = "110.42.233.109";
    /** 数据库端口 */
    private static final int DB_PORT = 3306;
    /** 数据库名称 */
    private static final String DB_NAME = "blue_whale";
    /** 数据库用户名 */
    private static final String DB_USER = "root";
    /** 数据库密码 */
    private static final String DB_PASSWORD = "root1024";

    public static void main(String[] args) {
        createDatabaseIfNotExists();
        SpringApplication.run(AgentApplication.class, args);
    }

    /**
     * 启动前确保数据库存在；若不存在则按 utf8mb4 字符集创建。
     */
    private static void createDatabaseIfNotExists() {
        String url = String.format(
                "jdbc:mysql://%s:%d/?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=Asia/Shanghai",
                DB_HOST, DB_PORT
        );
        try (Connection conn = DriverManager.getConnection(url, DB_USER, DB_PASSWORD);
             Statement stmt = conn.createStatement()) {
            stmt.executeUpdate(
                    "CREATE DATABASE IF NOT EXISTS " + DB_NAME +
                            " CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            );
        } catch (SQLException e) {
            throw new RuntimeException("无法创建数据库 " + DB_NAME, e);
        }
    }
}
