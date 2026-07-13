package com.blue.whale.web.config;


import org.springframework.boot.web.servlet.filter.OrderedCharacterEncodingFilter;
import org.springframework.context.annotation.Bean;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.converter.StringHttpMessageConverter;
import org.springframework.lang.NonNull;
import org.springframework.web.filter.CharacterEncodingFilter;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurationSupport;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * WebAppConfig
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: 序列化设置
 */
public class WebAppConfig extends WebMvcConfigurationSupport {

    private static final Charset CHARSET = StandardCharsets.UTF_8;

    @Bean
    public CharacterEncodingFilter characterEncodingFilter() {
        CharacterEncodingFilter filter = new OrderedCharacterEncodingFilter();
        filter.setEncoding(CHARSET.name());
        filter.setForceRequestEncoding(true);
        filter.setForceResponseEncoding(true);
        return filter;
    }

    @Override
    public void configureMessageConverters(@NonNull List<HttpMessageConverter<?>> converters) {
        super.configureMessageConverters(converters);
        converters.add(new StringHttpMessageConverter(CHARSET));
    }
}
