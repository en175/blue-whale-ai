package com.blue.whale.tool.upload;

import com.blue.whale.tool.upload.service.AbstractStorageService;
import com.blue.whale.tool.upload.service.VolcengineStorageService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.TestPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * §7.7 凭证齐 → UploadAutoConfiguration 创建 VolcengineStorageService Bean。
 *
 * <p>VolcengineStorageService 构造只 build TOS client（惰性连接，不触网），凭证齐测试创建 Bean 安全。
 */
@SpringBootTest(classes = UploadAutoConfiguration.class)
@TestPropertySource(properties = {
        "oss.tos.region=cn-beijing",
        "oss.tos.endpoint=https://tos-cn-beijing.volces.com",
        "oss.tos.access-key=AKTEST",
        "oss.tos.secret-key=SKTEST",
        "oss.tos.bucket-name=bluewhale-assets"
})
class UploadAutoConfigurationWithCredsTest {

    @Autowired
    private ApplicationContext ctx;

    @Test
    void createsVolcengineBeanWhenCredsPresent() {
        AbstractStorageService bean = ctx.getBean(AbstractStorageService.class);
        assertThat(bean).isInstanceOf(VolcengineStorageService.class);
    }
}
