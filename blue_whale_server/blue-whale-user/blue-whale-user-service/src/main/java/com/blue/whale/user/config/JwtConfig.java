package com.blue.whale.user.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * JWT 配置
 */
@Data
@Configuration
@ConfigurationProperties(prefix = "jwt")
public class JwtConfig {
    /** 签名密钥 */
    private String secret;
    /** 过期时间（秒），默认7天 */
    private long expiration = 604800;
}
