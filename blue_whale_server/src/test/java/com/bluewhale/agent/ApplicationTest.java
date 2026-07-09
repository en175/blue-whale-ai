package com.bluewhale.agent;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 全量上下文启动测试：验证无 MySQL（HikariCP lazy）+ 无 ARK_API_KEY（bean 仍创建，apiKey=""）下
 * Spring 上下文可正常装配。固化「脚手架能启动」这一基线。
 */
@SpringBootTest
class ApplicationTest {

    @Autowired
    private ApplicationContext context;

    @Test
    void contextLoads() {
        assertThat(context).isNotNull();
    }
}
