package com.blue.whale.tool.upload.model;


import com.blue.whale.tool.upload.enums.StorageType;
import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.io.Serializable;

/**
 * OssConfig
 *
 * @author: Jiyeon2__
 * date: 2025/6/30
 * description: 云存储配置类（Spring Boot 自动装配，prefix = oss.volcengine）
 */
@Data
@ConfigurationProperties(prefix = "oss.volcengine")
public class OssConfig implements Serializable {
    private static final long serialVersionUID = 1L;

    /**
     * 当前使用类型 1：阿里云 2 火山引擎
     */
    private StorageType type = StorageType.VOLCENGINE;

    /**
     * 火山引擎绑定的域名
     */
    private String domain = "https://sweet-oa.tos-cn-beijing.volces.com";

    /**
     * 火山引擎路径前缀
     */
    private String prefix = "sweet-oa";

    /**
     * 火山引擎 Endpoint
     */
    private String endpoint = "https://tos-cn-beijing.volces.com";

    /**
     * 火山引擎 Region
     */
    private String region = "cn-beijing";

    /**
     * 火山引擎 AccessKey（必填，无默认值）
     */
    private String accessKey;

    /**
     * 火山引擎 SecretKey（必填，无默认值）
     */
    private String secretKey;

    /**
     * 火山引擎 BucketName（必填，无默认值）
     */
    private String bucketName;
}