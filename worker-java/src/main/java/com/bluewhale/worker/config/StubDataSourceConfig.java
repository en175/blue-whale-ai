package com.bluewhale.worker.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Conditional;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;
import java.io.PrintWriter;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.logging.Logger;

/**
 * 空数据源回退（当 media_extract 未启用时）。
 * <p>
 * MyBatis-Plus auto-configuration 需要一个 DataSource bean 来创建 SqlSessionFactory。
 * 当 media_extract 未启用时，mapper bean 虽会被创建但不会被调用，
 * 因此这个 stub DataSource 永远不会被实际连接。
 * <p>
 * 这使得应用可以在没有 DATABASE_URL 的情况下安全启动并响应 /ready。
 */
@Configuration
public class StubDataSourceConfig {

    @Bean
    @Conditional(TagsEnabledConditions.NoTagsEnabled.class)
    public DataSource stubDataSource() {
        return new DataSource() {
            @Override
            public Connection getConnection() throws SQLException {
                throw new SQLException("Stub DataSource: no database configured (media_extract not enabled)");
            }

            @Override
            public Connection getConnection(String username, String password) throws SQLException {
                throw new SQLException("Stub DataSource: no database configured (media_extract not enabled)");
            }

            @Override
            public PrintWriter getLogWriter() { return null; }

            @Override
            public void setLogWriter(PrintWriter out) {}

            @Override
            public void setLoginTimeout(int seconds) {}

            @Override
            public int getLoginTimeout() { return 0; }

            @Override
            public Logger getParentLogger() { return Logger.getLogger("stub"); }

            @Override
            public <T> T unwrap(Class<T> iface) throws SQLException {
                throw new SQLException("Not a wrapper");
            }

            @Override
            public boolean isWrapperFor(Class<?> iface) { return false; }
        };
    }

    /** 条件：media_extract 未启用（与 MediaExtractEnabledCondition 互斥）。 */
    public static class NoMediaExtractCondition implements org.springframework.context.annotation.Condition {
        private final MediaExtractEnabledCondition delegate = new MediaExtractEnabledCondition();

        @Override
        public boolean matches(org.springframework.context.annotation.ConditionContext context,
                               org.springframework.core.type.AnnotatedTypeMetadata metadata) {
            return !delegate.matches(context, metadata);
        }
    }
}
