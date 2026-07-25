package com.blue.whale.tool.upload;

import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.tool.upload.model.OssConfig;
import com.blue.whale.tool.upload.service.AbstractStorageService;
import com.blue.whale.tool.upload.service.VolcengineStorageService;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;

/**
 * UploadAutoConfiguration
 *
 * @author: Jiyeon2__
 * date: 2025/7/10
 * description: OSS 上传自动装配
 */
@AutoConfiguration
@EnableConfigurationProperties(OssConfig.class)
public class UploadAutoConfiguration {

    @Bean
    public AbstractStorageService storageService(OssConfig ossConfig) {
        if (ossConfig == null) {
            throw new GlobalException("未读取到 OSS 配置");
        }
        return switch (ossConfig.getType()) {
            case VOLCENGINE -> new VolcengineStorageService(ossConfig);
            case ALI_YUN -> throw new GlobalException("阿里云暂不支持");
        };
    }
}