package com.blue.whale.web.remote;

import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.context.annotation.Bean;
import org.springframework.http.HttpHeaders;

import java.util.Map;

/**
 * SystemRestTemplateRequestInterceptor
 *
 * @author: Jiyeon2__
 * date: 2024/8/15
 * description:
 */
@ConditionalOnClass(name = "org.springframework.http.client.ClientHttpRequestInterceptor")
public class SystemRestTemplateRequestInterceptor {

    @Bean("systemClientHttpRequestInterceptor")
    public org.springframework.http.client.ClientHttpRequestInterceptor clientHttpRequestInterceptor() {
        return (request, body, execution) -> {

            HttpHeaders headers = request.getHeaders();
            Map<String, String> requestHeaders = HeaderRender.requestHeaders();
            requestHeaders.forEach(headers::add);
            return execution.execute(request, body);
        };
    }
}
