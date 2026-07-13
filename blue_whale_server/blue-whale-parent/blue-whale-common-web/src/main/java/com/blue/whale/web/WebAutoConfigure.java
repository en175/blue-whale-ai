package com.blue.whale.web;


import cn.hutool.core.date.DatePattern;
import cn.hutool.core.util.StrUtil;
import cn.hutool.extra.spring.SpringUtil;
import com.blue.whale.web.config.RestExceptionConfig;
import com.blue.whale.web.config.WebAppConfig;
import com.blue.whale.web.filter.SystemFilter;
import com.blue.whale.web.remote.SystemRestTemplateRequestInterceptor;
import com.blue.whale.web.spring.listener.SweetOaAutoConfigureSpringListener;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.core.convert.converter.Converter;
import org.springframework.lang.NonNull;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;

/**
 * WebAutoConfigure
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description:
 */@Import({
        WebAppConfig.class,
        RestExceptionConfig.class,
        SpringUtil.class,
        SystemFilter.class,
        SystemRestTemplateRequestInterceptor.class
})
public class WebAutoConfigure {

    @Bean
    public Converter<String, LocalTime> localTimeConverter() {
        return new Converter<>() {
            @Override
            public LocalTime convert(@NonNull String value) {
                if (StrUtil.isEmpty(value)) {
                    return null;
                }
                return LocalTime.parse(value, DatePattern.NORM_TIME_FORMATTER);
            }
        };
    }

    @Bean
    public Converter<String, LocalDate> localDateConverter() {
        return new Converter<>() {
            @Override
            public LocalDate convert(@NonNull String value) {
                if (StrUtil.isEmpty(value)) {
                    return null;
                }
                return LocalDate.parse(value, DatePattern.NORM_DATE_FORMATTER);
            }
        };
    }

    @Bean
    public Converter<String, LocalDateTime> localDateTimeConverter() {
        return new Converter<>() {
            @Override
            public LocalDateTime convert(@NonNull String value) {
                if (StrUtil.isEmpty(value)) {
                    return null;
                }
                if (value.length() == DatePattern.NORM_DATE_PATTERN.length()) {
                    LocalDate localDate = LocalDate.parse(value, DatePattern.NORM_DATE_FORMATTER);
                    return localDate.atStartOfDay();
                }
                return LocalDateTime.parse(value, DatePattern.NORM_DATETIME_FORMATTER);
            }
        };

    }
}
