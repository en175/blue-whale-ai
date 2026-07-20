package com.blue.whale.tool.upload.model;

import com.blue.whale.tool.upload.enums.StorageType;
import lombok.Getter;
import lombok.Setter;
import lombok.ToString;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 火山引擎 TOS 云存储配置。
 *
 * <p>所有值走配置中心（Nacos / application.yml），{@code @ConfigurationProperties} 自动映射。
 * AK/SK/Bucket 为空时 {@code UploadAutoConfiguration} 不创建 Bean，本地开发无需凭证。
 * 访问域名由 {@code prefix} 自动推导：{@code https://{prefix}.tos-cn-beijing.volces.com}。</p>
 *
 * @author: Jiyeon2__
 * date: 2025/6/30
 */
@Getter
@Setter
@ToString(exclude = {"accessKey", "secretKey"})
@ConfigurationProperties(prefix = "oss.tos")
public class OssConfig {
    /** 云存储厂商，默认火山引擎 */
    private StorageType type = StorageType.VOLCENGINE;
    /** 火山引擎路径前缀，同时用于推导访问域名 */
    private String prefix = "sweet-oa";
    /** 火山引擎 Endpoint */
    private String endpoint = "https://tos-cn-beijing.volces.com";
    /** 火山引擎 Region */
    private String region = "cn-beijing";
    /** 火山引擎 AccessKey（走 Nacos 配置中心下发） */
    private String accessKey;
    /** 火山引擎 SecretKey（走 Nacos 配置中心下发） */
    private String secretKey;
    /** 火山引擎 Bucket 名称（走 Nacos 配置中心下发） */
    private String bucketName;

    /** 访问域名 = https://{bucketName}.tos-cn-beijing.volces.com */
    public String getDomain() {
        return "https://" + bucketName + ".tos-cn-beijing.volces.com";
    }
}
