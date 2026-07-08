package com.blue.whale.security.resource;


import com.blue.whale.security.resource.config.ClientAndTokenStateConfig;
import com.blue.whale.security.resource.exception.SecureExceptionAdvice;
import com.blue.whale.security.resource.helper.Security;
import com.blue.whale.security.resource.properties.ResourceProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Import;
import org.springframework.security.config.annotation.method.configuration.EnableGlobalMethodSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.oauth2.config.annotation.web.configuration.EnableResourceServer;

/**
 * ResourceServerAutoconfigure
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: 安全配置自动装配
 */
@Import({
        SecureExceptionAdvice.class,
        Security.class,
        ClientAndTokenStateConfig.class
})
@EnableResourceServer
@EnableWebSecurity
@EnableGlobalMethodSecurity(prePostEnabled = true)
@EnableConfigurationProperties(ResourceProperties.class)
public class ResourceServerAutoConfigure {
}
