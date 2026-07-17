package com.blue.whale.agent.service.governance;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * ContentReview 策略配置（ADR-0029）：策略是不可变配置包，任意变化创建新
 * {@code policyVersion}。本地非生产环境固定为确定性策略 {@code local-fake-v1}。
 */
@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "blue-whale.content-review")
public class ContentReviewProperties {

    private String policyVersion = "local-fake-v1";
}
