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
     * 当前使用类型 1：阿里云 2火山 引擎
     */
    private StorageType type = StorageType.VOLCENGINE;

//    /**
//     * 阿里云绑定的域名
//     */
//    private String aliyunDomain = "https://bwpn.oss-cn-hangzhou.aliyuncs.com";
//    /**
//     * 阿里云路径前缀
//     */
//    private String aliyunPrefix = "blue-whole-butler";
//    /**
//     * 阿里云EndPoint
//     */
//    private String aliyunEndPoint = "https://oss-cn-hangzhou.aliyuncs.com";
//    /**
//     * 阿里云AccessKeyId
//     */
//    private String aliyunAccessKeyId = "LTAI5t7CTnGeKAnRujq6S9hY";
//    /**
//     * 阿里云AccessKeySecret
//     */
//    private String aliyunAccessKeySecret = "EivJhcY5dV6BfekAuAOeOafNK4zIN6";
//    /**
//     * 阿里云BucketName
//     */
//    private String aliyunBucketName = "bwpn";

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
    private String veTosAccessKey = "AKLTODYwMzRhMjAzNzcxNGY1ZDhiNGMyMWMyNzEzYmIxM2M";
    /**
     * 火山引擎SecretKey
     */
    private String veTosSecretKey = "TlRSak5HSXdaVEZrWTJFMU5ESmxaRGt3Tnprek5qYzRNRFF4WW1GbE16SQ==";
    /**
     * 火山引擎BucketName
     */
    private String veTosBucketName = "sweet-oa";
}
