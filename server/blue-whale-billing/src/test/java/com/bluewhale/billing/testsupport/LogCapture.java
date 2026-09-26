package com.bluewhale.billing.testsupport;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.slf4j.LoggerFactory;

import java.util.List;

/**
 * 抓某个类打出来的日志（测试用）。
 *
 * <p>为什么需要它：对账两条任务的**产物就是日志**——「超时预留只告警不动作」这件事，
 * 除了日志没有别的可观测面（它刻意不改任何数据）。所以「日志里有没有条数、
 * 有没有 jobId/冻结额/持有秒数」不是格式偏好，而是这两条任务能不能被人接手的**功能本身**：
 * 一条只有「有一批超时了」的日志，等于把「接手」变成「再查一遍」。
 *
 * <p>只挂在被测类自己的 logger 上（不 root 全量抓），用完即摘——
 * 测试之间共享 JVM，漏摘会让后一个用例看见前一个用例的日志。
 */
public final class LogCapture implements AutoCloseable {

    private final Logger logger;
    private final ListAppender<ILoggingEvent> appender = new ListAppender<>();

    private LogCapture(Class<?> type) {
        this.logger = (Logger) LoggerFactory.getLogger(type);
        appender.start();
        logger.addAppender(appender);
    }

    public static LogCapture of(Class<?> type) {
        return new LogCapture(type);
    }

    /** 该级别的全部日志（按输出顺序），已套好占位符。 */
    public List<String> messages(Level level) {
        return appender.list.stream()
                .filter(event -> event.getLevel() == level)
                .map(ILoggingEvent::getFormattedMessage)
                .toList();
    }

    /** 合并成一段文本，便于 assertThat(...).contains(...) 一次断言多点。 */
    public String text(Level level) {
        return String.join("\n", messages(level));
    }

    @Override
    public void close() {
        logger.detachAppender(appender);
        appender.stop();
    }
}
