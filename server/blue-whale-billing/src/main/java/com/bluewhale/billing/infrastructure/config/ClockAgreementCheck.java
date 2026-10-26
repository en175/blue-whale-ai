package com.bluewhale.billing.infrastructure.config;

import jakarta.annotation.PostConstruct;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.TimeZone;

@Component
public class ClockAgreementCheck {

    private final DataSource dataSource;

    public ClockAgreementCheck(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @PostConstruct
    void requireAgreement() {
        int databaseOffsetSeconds;
        try (Connection connection = dataSource.getConnection();
             Statement statement = connection.createStatement();
             ResultSet rows = statement.executeQuery(
                     "SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW())")) {
            rows.next();
            databaseOffsetSeconds = rows.getInt(1);
        } catch (SQLException e) {
            throw new IllegalStateException("数据库会话时区无法确认，装配期终止", e);
        }

        int jvmOffsetSeconds = TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 1000;
        if (databaseOffsetSeconds != jvmOffsetSeconds) {
            throw new IllegalStateException(String.format(
                    "Java 的钟与数据库的钟不是同一个：JVM 默认时区偏移 %d 秒，数据库会话时区偏移 %d 秒。"
                            + "容器必须带 TZ=Asia/Shanghai，BILLING_DB_URL 必须带 "
                            + "connectionTimeZone=Asia/Shanghai&forceConnectionTimeZoneToSession=true。"
                            + "配错时 Java 算出的到期时刻与库里的墙钟错开整小时，"
                            + "到期判定与账本对账跟着错，且不会以任何其它形式报错。",
                    jvmOffsetSeconds, databaseOffsetSeconds));
        }
    }
}
