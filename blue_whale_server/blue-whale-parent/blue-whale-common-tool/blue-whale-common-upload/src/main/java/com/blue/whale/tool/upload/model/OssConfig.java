package com.blue.whale.tool.upload.model;


import com.blue.whale.tool.upload.enums.StorageType;
import lombok.Data;

import java.io.Serializable;

/**
 * OssConfigBO
 *
 * @author: Jiyeon2__
 * date: 2025/6/30
 * description: 云存储配置类
 */
@Data
public class OssConfig implements Serializable {
    private static final long serialVersionUID = 1L;
    /**
     * 当前使用类型 1：阿里云 2 火山引擎
     */
    private StorageType type = StorageType.VOLCENGINE;

    /**
     * 火山引擎绑定的域名
     */
    private String veTosDomain = "https://sweet-oa.tos-cn-beijing.volces.com";
    /**
     * 火山引擎路径前缀
     */
    private String veTosPrefix = "sweet-oa";
    /**
     * 火山引擎Endpoint
     */
    private String veTosEndpoint = "https://tos-cn-beijing.volces.com";
    /**
     * 火山引擎Region
     */
    private String veTosRegion = "cn-beijing";
    /**
     * 火山引擎AccessKey
     */
    private String veTosAccessKey = System.getenv("TOS_ACCESS_KEY");
    /**
     * 火山引擎SecretKey
     */
    private String veTosSecretKey = System.getenv("TOS_SECRET_KEY");
    /**
     * 火山引擎BucketName
     */
    private String veTosBucketName = System.getenv("TOS_BUCKET_NAME");
}