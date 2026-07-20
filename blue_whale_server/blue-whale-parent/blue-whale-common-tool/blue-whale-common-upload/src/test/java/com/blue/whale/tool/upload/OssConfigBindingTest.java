package com.blue.whale.tool.upload;

import com.blue.whale.tool.upload.enums.StorageType;
import com.blue.whale.tool.upload.model.OssConfig;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * §7.5 OssConfig 绑定：验 {@code oss.tos.*} → 字段映射，bucket=bluewhale-assets，域名由 bucket 推导。
 */
@SpringBootTest(classes = UploadAutoConfiguration.class)
@TestPropertySource(properties = {
        "oss.tos.type=VOLCENGINE",
        "oss.tos.prefix=blue-whale",
        "oss.tos.endpoint=https://tos-cn-beijing.volces.com",
        "oss.tos.region=cn-beijing",
        "oss.tos.access-key=AKTEST",
        "oss.tos.secret-key=SKTEST",
        "oss.tos.bucket-name=bluewhale-assets"
})
class OssConfigBindingTest {

    @Autowired
    private OssConfig ossConfig;

    @Test
    void bindsAllFieldsFromProperties() {
        assertThat(ossConfig.getType()).isEqualTo(StorageType.VOLCENGINE);
        assertThat(ossConfig.getPrefix()).isEqualTo("blue-whale");
        assertThat(ossConfig.getEndpoint()).isEqualTo("https://tos-cn-beijing.volces.com");
        assertThat(ossConfig.getRegion()).isEqualTo("cn-beijing");
        assertThat(ossConfig.getAccessKey()).isEqualTo("AKTEST");
        assertThat(ossConfig.getSecretKey()).isEqualTo("SKTEST");
        assertThat(ossConfig.getBucketName()).isEqualTo("bluewhale-assets");
    }

    @Test
    void domainDerivedFromBucketName() {
        assertThat(ossConfig.getDomain())
                .isEqualTo("https://bluewhale-assets.tos-cn-beijing.volces.com");
    }
}
