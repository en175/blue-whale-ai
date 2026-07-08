package com.blue.whale.tool.log.properties;


import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.HashSet;
import java.util.Set;

/**
 * LogProperties
 *
 * @author: Jiyeon2__
 * date: 2025/3/26
 * description: 日志配置
 */
@ConfigurationProperties(prefix = "logging")
@Getter
@Setter
public class LogProperties {

    private Set<String> headerNames = new HashSet<>();
}
