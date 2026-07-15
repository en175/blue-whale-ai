package com.blue.whale.tool.upload;

import com.blue.whale.tool.upload.service.AbstractStorageService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.NoSuchBeanDefinitionException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * §7.7 缺凭证 → UploadAutoConfiguration 跳过 Bean（storageService() 返回 null → NullBean 不注入）。
 *
 * <p>本地开发无 TOS 凭证时服务可启动（asset/头像上传功能不可用，但不阻塞启动）。
 */
@SpringBootTest(classes = UploadAutoConfiguration.class)
class UploadAutoConfigurationNoCredsTest {

    @Autowired
    private ApplicationContext ctx;

    @Test
    void skipsBeanWhenCredsMissing() {
        // AK/SK/bucket 全空 → storageService() 返回 null → Spring 注册 NullBean（不 assignable）
        assertThatThrownBy(() -> ctx.getBean(AbstractStorageService.class))
                .isInstanceOf(NoSuchBeanDefinitionException.class);
    }
}
