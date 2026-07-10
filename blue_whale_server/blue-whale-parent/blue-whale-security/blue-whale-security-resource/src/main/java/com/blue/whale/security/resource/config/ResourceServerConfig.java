package com.blue.whale.security.resource.config;


import com.blue.whale.security.resource.exception.ExceptionAccessDeniedHandler;
import com.blue.whale.security.resource.exception.ExceptionEntryPoint;
import com.blue.whale.security.resource.properties.ResourceProperties;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.config.annotation.web.configuration.ResourceServerConfigurerAdapter;
import org.springframework.security.oauth2.config.annotation.web.configurers.ResourceServerSecurityConfigurer;

/**
 * ResourceServerConfig
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description:
 */
@Configuration
@RequiredArgsConstructor
public class ResourceServerConfig extends ResourceServerConfigurerAdapter {

    private final ResourceProperties resourceProperties;

    @Override
    public void configure(ResourceServerSecurityConfigurer resources) {
        resources.stateless(true);
        resources.accessDeniedHandler(new ExceptionAccessDeniedHandler());
        resources.authenticationEntryPoint(new ExceptionEntryPoint());
    }

    @Override
    public void configure(HttpSecurity http) throws Exception {
        http.authorizeRequests()
                .anyRequest()
                .permitAll();

        if (!resourceProperties.isEnableFrameOptions()) {
            http.headers().frameOptions().disable();
        }
        http.formLogin().disable()
                .cors().disable()
                .csrf().disable()
                .sessionManagement().sessionCreationPolicy(SessionCreationPolicy.STATELESS);

    }
}

