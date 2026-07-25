package com.blue.whale.agent.common.web;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.blue.whale.global.base.resp.Result;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataRetrievalFailureException;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link RestExceptionConfig} 数据访问异常处理单测（IK1W1K）。
 *
 * <p>验收点：意外数据库异常对 User 仍是统一脱敏提示「服务暂时不可用」，
 * 但服务端日志必须保留底层原因，并携带与当前公开请求一致的 Request ID，
 * 使运维能用响应头 {@code X-Request-Id} 反查日志定位根因。
 */
class RestExceptionConfigTest {

    private final RestExceptionConfig config = new RestExceptionConfig();

    private Logger logger;
    private ListAppender<ILoggingEvent> appender;

    @BeforeEach
    void setUp() {
        logger = (Logger) LoggerFactory.getLogger(RestExceptionConfig.class);
        appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
    }

    @AfterEach
    void tearDown() {
        logger.detachAppender(appender);
        RequestContextHolder.resetRequestAttributes();
    }

    @Test
    void dataAccessErrorKeepsSafeMessageAndLogsRequestIdWithCause() {
        bindRequestId("req_template_page_500");

        Result<Object> result = config.handleError(
                new DataRetrievalFailureException("Unknown column 'is_delete' in 'where clause'"));

        // 对 User：统一脱敏提示，不泄漏底层原因
        assertThat(result.getCode()).isEqualTo(500);
        assertThat(result.getMsg()).isEqualTo("服务暂时不可用");
        assertThat(result.getMsg()).doesNotContain("is_delete");

        // 对运维：ERROR 日志含 Request ID，且保留底层异常（堆栈与原因）
        ILoggingEvent event = singleErrorEvent();
        assertThat(event.getFormattedMessage()).contains("req_template_page_500");
        assertThat(event.getThrowableProxy()).isNotNull();
        assertThat(event.getThrowableProxy().getMessage()).contains("is_delete");
    }

    @Test
    void transactionErrorKeepsSafeMessageAndLogsRequestIdWithCause() {
        bindRequestId("req_template_tx_500");

        Result<Object> result = config.handleError(
                new CannotCreateTransactionException("Could not open JDBC Connection"));

        assertThat(result.getCode()).isEqualTo(500);
        assertThat(result.getMsg()).isEqualTo("服务暂时不可用");

        ILoggingEvent event = singleErrorEvent();
        assertThat(event.getFormattedMessage()).contains("req_template_tx_500");
        assertThat(event.getThrowableProxy()).isNotNull();
        assertThat(event.getThrowableProxy().getMessage()).contains("JDBC");
    }

    @Test
    void dataAccessErrorWithoutRequestContextStillLogs() {
        // 无请求上下文（如后台线程触发）时不应抛 NPE，日志照常输出
        Result<Object> result = config.handleError(new DataRetrievalFailureException("boom"));

        assertThat(result.getCode()).isEqualTo(500);
        ILoggingEvent event = singleErrorEvent();
        assertThat(event.getThrowableProxy()).isNotNull();
    }

    /** 模拟 {@link PublicRequestIdFilter} 为当前请求写入的 Request ID 属性 */
    private void bindRequestId(String requestId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setAttribute(PublicRequestId.ATTRIBUTE, requestId);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private ILoggingEvent singleErrorEvent() {
        assertThat(appender.list)
                .filteredOn(e -> e.getLevel() == Level.ERROR)
                .hasSize(1);
        return appender.list.stream()
                .filter(e -> e.getLevel() == Level.ERROR)
                .findFirst()
                .orElseThrow();
    }
}
