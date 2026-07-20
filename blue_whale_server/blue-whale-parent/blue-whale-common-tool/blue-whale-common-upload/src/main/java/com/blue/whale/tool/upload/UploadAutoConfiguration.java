package com.blue.whale.tool.upload;

import cn.hutool.core.util.StrUtil;
import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.tool.upload.model.OssConfig;
import com.blue.whale.tool.upload.service.AbstractStorageService;
import com.blue.whale.tool.upload.service.VolcengineStorageService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;

/**
 * OSS 上传自动装配。
 *
 * <p>仅在 TOS 凭证俱备时才创建 {@link AbstractStorageService} Bean；
 * 缺少任一环境变量则跳过，允许本地开发不依赖 TOS 启动。</p>
 *
 * @author: Jiyeon2__
 * date: 2025/7/10
 */
@Slf4j
@AutoConfiguration
@EnableConfigurationProperties(OssConfig.class)
public class UploadAutoConfiguration {

    /** TOS 客户端连接池最大连接数 */
    private static final int TOS_MAX_CONNECTIONS = 200;
    /** 连接超时（毫秒） */
    private static final int TOS_CONNECT_TIMEOUT_MS = 5_000;
    /** 读取超时（毫秒） */
    private static final int TOS_READ_TIMEOUT_MS = 30_000;
    /** 空闲连接存活时间（毫秒） */
    private static final int TOS_IDLE_CONNECTION_ALIVE_MS = 60_000;

    @Bean
    @ConditionalOnProperty(name = "oss.tos.enabled", havingValue = "true", matchIfMissing = true)
    public AbstractStorageService storageService(OssConfig ossConfig) {
        if (ossConfig == null) {
            log.warn("未读取到 OSS 配置，跳过 storageService 初始化");
            return null;
        }
        // 凭证缺失时跳过 Bean 创建，允许本地开发不依赖 TOS 启动
        if (StrUtil.isBlank(ossConfig.getAccessKey())) {
            log.warn("TOS_ACCESS_KEY 未配置，跳过 storageService 初始化。头像上传功能不可用。");
            return null;
        }
        if (StrUtil.isBlank(ossConfig.getSecretKey())) {
            log.warn("TOS_SECRET_KEY 未配置，跳过 storageService 初始化。头像上传功能不可用。");
            return null;
        }
        if (StrUtil.isBlank(ossConfig.getBucketName())) {
            log.warn("TOS_BUCKET_NAME 未配置，跳过 storageService 初始化。头像上传功能不可用。");
            return null;
        }
        return switch (ossConfig.getType()) {
            case VOLCENGINE -> new VolcengineStorageService(ossConfig,
                    TOS_MAX_CONNECTIONS, TOS_CONNECT_TIMEOUT_MS,
                    TOS_READ_TIMEOUT_MS, TOS_IDLE_CONNECTION_ALIVE_MS);
            case ALI_YUN -> throw new GlobalException("阿里云暂不支持");
        };
    }
}
