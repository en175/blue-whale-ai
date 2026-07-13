package com.blue.whale.security.resource.config;


import com.blue.whale.security.resource.properties.ResourceProperties;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.WebSecurityConfigurerAdapter;
import org.springframework.security.jwt.crypto.sign.RsaVerifier;
import org.springframework.security.oauth2.provider.token.DefaultTokenServices;
import org.springframework.security.oauth2.provider.token.ResourceServerTokenServices;
import org.springframework.security.oauth2.provider.token.store.JwtAccessTokenConverter;
import org.springframework.security.oauth2.provider.token.store.JwtTokenStore;

/**
 * ResourceTokenConfig
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: 默认的token配置
 */
@Configuration
@RequiredArgsConstructor
public class ResourceTokenConfig{

    private final ResourceProperties resourceProperties;

    @Bean
    @ConditionalOnProperty(prefix = "spring.security.oauth2.resource.server",name = "authorization-server",havingValue = "false",matchIfMissing = true)
    public WebSecurityConfigurerAdapter webSecurityConfigurerAdapter(){
        return new WebSecurityConfigurerAdapter() {
            @Override
            protected void configure(HttpSecurity http) {
            }
        };
    }

    /**
     * token解析器
     */
    @Bean
    @ConditionalOnMissingBean
    public JwtAccessTokenConverter tokenEnhancer() {
        JwtAccessTokenConverter jwtAccessTokenConverter = new JwtAccessTokenConverter();
        jwtAccessTokenConverter.setVerifier(new RsaVerifier(resourceProperties.getKey().rsaPublicKey()));
        return jwtAccessTokenConverter;
    }

    /**
     * 资源服务器令牌服务 服务接口 {@link Bean}
     */
    @Bean
    @ConditionalOnMissingBean
    public ResourceServerTokenServices resourceServerTokenServices(JwtAccessTokenConverter jwtAccessTokenConverter) {
        DefaultTokenServices tokenServices = new DefaultTokenServices();
        tokenServices.setTokenStore(new JwtTokenStore(jwtAccessTokenConverter));
        return tokenServices;
    }

}
