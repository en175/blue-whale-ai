package com.bluewhale.billing.testsupport;

import org.junit.jupiter.api.extension.BeforeEachCallback;
import org.junit.jupiter.api.extension.ConditionEvaluationResult;
import org.junit.jupiter.api.extension.ExecutionCondition;
import org.junit.jupiter.api.extension.ExtensionContext;
import org.opentest4j.TestAbortedException;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.core.annotation.MergedAnnotations;
import org.springframework.test.context.junit.jupiter.SpringExtension;

import javax.sql.DataSource;
import java.io.IOException;
import java.io.InputStream;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Properties;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class BillingTestDatabaseGate implements ExecutionCondition, BeforeEachCallback {

    private static final String URL_VAR = "BILLING_TEST_DB_URL";

    private static final Pattern PLACEHOLDER =
            Pattern.compile("^\\$\\{([A-Za-z0-9_.]+):(.*)}$", Pattern.DOTALL);

    private static final Pattern TEST_DATABASE = Pattern.compile("bw_billing_test(_[A-Za-z0-9_]+)?");

    private static final Pattern JDBC_URL =
            Pattern.compile("^jdbc:mysql://([^/?]+)/([^?]*)(\\?.*)?$");

    private static final Set<String> PREPARED = ConcurrentHashMap.newKeySet();
    private static final Set<String> ANNOUNCED = ConcurrentHashMap.newKeySet();

    private static final Set<String> VERIFIED = ConcurrentHashMap.newKeySet();


    @Override
    public ConditionEvaluationResult evaluateExecutionCondition(ExtensionContext context) {
        if (!isDatabaseTest(context)) {
            return ConditionEvaluationResult.enabled("非 @SpringBootTest 用例：不连库，门禁不适用");
        }
        if (!passwordProvided()) {
            if (ANNOUNCED.add("未设 BILLING_DB_PASSWORD")) {
                notice("未设 BILLING_DB_PASSWORD → 真库集成测试整体跳过（沿用既有门控）。"
                        + "设上它就会跑在测试专用库上，开发库 bw_billing 不受影响。");
            }
            return ConditionEvaluationResult.enabled("未设 BILLING_DB_PASSWORD：交给 @EnabledIfEnvironmentVariable 跳过");
        }

        String testUrl = effectiveTestUrl();
        String database = databaseName(testUrl);
        if (!isTestDatabase(database)) {
            String reason = refuseReason(database);
            warn(reason);
            return ConditionEvaluationResult.disabled(reason);
        }
        try {
            prepare(database, testUrl);
        } catch (RuntimeException error) {
            String reason = "真库集成测试跳过：测试专用库 " + database + " 不可用（"
                    + error.getMessage() + "）";
            warn(reason);
            return ConditionEvaluationResult.disabled(reason);
        }
        if (ANNOUNCED.add(database)) {
            notice("真库集成测试目标库 = " + database
                    + "（开发库 bw_billing 不在其中：这些用例的 DELETE 只落在这一个库上）");
        }
        return ConditionEvaluationResult.enabled("目标库 " + database + " 是测试专用库");
    }


    @Override
    public void beforeEach(ExtensionContext context) {
        if (!isDatabaseTest(context) || !passwordProvided()) {
            return;
        }
        String testClass = context.getRequiredTestClass().getName();
        if (VERIFIED.contains(testClass)) {
            return;
        }

        String actual;
        try {
            ApplicationContext applicationContext = SpringExtension.getApplicationContext(context);
            DataSource dataSource = applicationContext.getBean(DataSource.class);
            try (Connection connection = dataSource.getConnection();
                 Statement statement = connection.createStatement();
                 ResultSet rows = statement.executeQuery("SELECT DATABASE()")) {
                actual = rows.next() ? rows.getString(1) : null;
            }
        } catch (Exception error) {
            throw new TestAbortedException("真库集成测试中止：无法确认实际连接的目标库（"
                    + error.getClass().getSimpleName() + ": " + error.getMessage() + "）");
        }

        if (actual == null || !isTestDatabase(actual)) {
            throw new TestAbortedException("真库集成测试中止：实际连接的库是 `" + actual
                    + "`，不是测试专用库（要求 " + TEST_DATABASE.pattern() + "）。"
                    + "用例的 @BeforeEach 会 DELETE 清表，宁可不跑也不碰开发库 —— "
                    + "检查 application.properties 的 spring.datasource.url、"
                    + URL_VAR + " 或用例上的 properties 覆盖。");
        }
        VERIFIED.add(testClass);
    }


    private static boolean isDatabaseTest(ExtensionContext context) {
        return MergedAnnotations.from(context.getRequiredTestClass())
                .isPresent(SpringBootTest.class);
    }

    private static boolean passwordProvided() {
        return !isBlank(System.getenv("BILLING_DB_PASSWORD"));
    }

    static String effectiveTestUrl() {
        String override = !isBlank(System.getProperty(URL_VAR))
                ? System.getProperty(URL_VAR) : System.getenv(URL_VAR);
        if (!isBlank(override)) {
            return override;
        }
        String configured = configuredUrl();
        return configured == null ? "" : configured;
    }

    private static String configuredUrl() {
        String raw = configuredRawUrl();
        if (raw == null) {
            return null;
        }
        Matcher placeholder = PLACEHOLDER.matcher(raw.trim());
        if (!placeholder.matches()) {
            return raw.trim();
        }
        String override = !isBlank(System.getProperty(placeholder.group(1)))
                ? System.getProperty(placeholder.group(1)) : System.getenv(placeholder.group(1));
        return isBlank(override) ? configuredDefaultUrl() : override;
    }

    static String configuredDefaultUrl() {
        String raw = configuredRawUrl();
        if (raw == null) {
            return "";
        }
        Matcher placeholder = PLACEHOLDER.matcher(raw.trim());
        return placeholder.matches() ? placeholder.group(2).trim() : raw.trim();
    }

    private static String configuredRawUrl() {
        Properties properties = new Properties();
        try (InputStream in = BillingTestDatabaseGate.class.getClassLoader()
                .getResourceAsStream("application.properties")) {
            if (in == null) {
                return null;
            }
            properties.load(in);
        } catch (IOException error) {
            return null;
        }
        return properties.getProperty("spring.datasource.url");
    }

    static String databaseName(String url) {
        Matcher matcher = JDBC_URL.matcher(url == null ? "" : url.trim());
        return matcher.matches() ? matcher.group(2) : "";
    }

    static boolean isTestDatabase(String database) {
        return database != null && TEST_DATABASE.matcher(database).matches();
    }

    private static void prepare(String database, String url) {
        if (PREPARED.contains(database)) {
            return;
        }
        Matcher matcher = JDBC_URL.matcher(url.trim());
        if (!matcher.matches()) {
            throw new IllegalStateException("连接串形态无法识别（期望 jdbc:mysql://host:port/db）");
        }
        String serverUrl = "jdbc:mysql://" + matcher.group(1) + "/"
                + (matcher.group(3) == null ? "" : matcher.group(3));
        String user = envOrDefault("BILLING_DB_USERNAME", "root");
        String password = envOrDefault("BILLING_DB_PASSWORD", "");
        try (Connection connection = DriverManager.getConnection(serverUrl, user, password);
             Statement statement = connection.createStatement()) {
            statement.executeUpdate(
                    "CREATE DATABASE IF NOT EXISTS `" + database + "` DEFAULT CHARACTER SET utf8mb4");
        } catch (SQLException error) {
            throw new IllegalStateException(
                    error.getClass().getSimpleName() + ": " + error.getMessage(), error);
        }
        PREPARED.add(database);
    }

    private static String refuseReason(String database) {
        return "真库集成测试拒跑：目标库 `" + (isBlank(database) ? "(取不到库名)" : database)
                + "` 不是测试专用库（要求库名匹配 " + TEST_DATABASE.pattern() + "）。\n"
                + "    这些用例的 @BeforeEach 会 DELETE 清表，跑在开发库上等于清掉本地开发数据"
                + "（2026-09 已发生两次），所以这里选择不跑。\n"
                + "    改法二选一：\n"
                + "      · 取消 BILLING_TEST_DB_URL / BILLING_DB_URL，默认落点就是 bw_billing_test；\n"
                + "      · 或用 " + URL_VAR + " 指向一个库名为 bw_billing_test* 的库（不存在会自动建）。";
    }

    private static String envOrDefault(String name, String fallback) {
        String value = System.getenv(name);
        return isBlank(value) ? fallback : value;
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private static void notice(String message) {
        System.out.println("[billing-db-gate] " + message);
    }

    private static void warn(String message) {
        System.err.println("[billing-db-gate] ⚠️ " + message);
    }
}
