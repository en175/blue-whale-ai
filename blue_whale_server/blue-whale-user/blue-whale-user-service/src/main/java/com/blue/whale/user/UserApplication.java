package com.blue.whale.user;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * UserApplication
 *
 * @author: Jiyeon2__
 * date: 2024/9/27
 * description: 用户服务启动类
 */
@SpringBootApplication
@MapperScan("com.blue.whale.user.mapper")
public class UserApplication {

    public static void main(String[] args) {
        SpringApplication.run(UserApplication.class, args);
    }

}
