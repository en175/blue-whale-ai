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

/**
 * 真库集成测试的**库门禁**：只允许跑在测试专用库上。
 *
 * <p>为什么要有它：门控集成测试（{@code @EnabledIfEnvironmentVariable("BILLING_DB_PASSWORD")}）
 * 的 {@code @BeforeEach} 会 {@code DELETE} 清表。它们原先继承 {@code application.yml} 的默认连接串，
 * 而那个默认值是**开发库 {@code bw_billing}** —— 于是「有人在本地跑一次
 * {@code mvn -pl blue-whale-billing test}」就等于「清一次本地开发数据」。
 * 2026-09 这已经真实发生过两次（用户积分归零、定价目录被换成测试夹具）。
 * 「文档里写一句警告」拦不住：没人会预期「跑测试」会清掉开发库。
 *
 * <p>三条防线，各自独立：
 * <ol>
 *   <li><b>测试自己的连接串</b>（{@code src/test/resources/application.properties}）指向
 *       {@code bw_billing_test}，开发库的连接串在测试里根本不出现；</li>
 *   <li><b>本类的 {@code ExecutionCondition}</b>（上下文启动**之前**求值）：目标库名不匹配
 *       {@code bw_billing_test*} 就拒跑（跳过并打印怎么改），匹配则按需建库 ——
 *       Flyway 随后把 schema 建在测试库里；</li>
 *   <li><b>本类的 {@code BeforeEachCallback}</b>（{@code @BeforeEach} **之前**执行）：
 *       拿着上下文里**真正在用**的 DataSource 问一句 {@code SELECT DATABASE()}，
 *       库名仍不是测试专用就中止用例。第 1、2 条读的都是配置，只有这一条验的是事实 ——
 *       任何形态的覆盖（系统属性、用例上的 {@code properties}、动态属性）都绕不过它。</li>
 * </ol>
 *
 * <p>为什么要自动发现（{@code junit-platform.properties} + {@code META-INF/services}）而不是
 * 让每个用例挂注解：**要「记得挂上」的机制就是这次事故的成因**。新加的真库用例自动受保护。
 *
 * <p>⚠️ 跳过而不是报红：「没配测试库」是环境没准备好，不该伪装成「代码坏了」。
 * 但跳过一定看得见 —— 每次拒跑都打一行带 {@code [billing-db-gate]} 前缀的原因（含改法），
 * 未设口令导致的跳过在 surefire 汇总里另有 Skipped 计数。
 */
public final class BillingTestDatabaseGate implements ExecutionCondition, BeforeEachCallback {

    /** 测试库的连接串覆盖点（与 {@code application.properties} 里的占位名逐字相同）。 */
    private static final String URL_VAR = "BILLING_TEST_DB_URL";

    /** {@code ${BILLING_TEST_DB_URL:缺省值}} —— 只认我们自己在 application.properties 里写的这一种形态。 */
    private static final Pattern PLACEHOLDER =
            Pattern.compile("^\\$\\{([A-Za-z0-9_.]+):(.*)}$", Pattern.DOTALL);

    /** 测试专用库的库名形态。**开发库 {@code bw_billing} 不在其中**，这是本门禁的全部依据。 */
    private static final Pattern TEST_DATABASE = Pattern.compile("bw_billing_test(_[A-Za-z0-9_]+)?");

    /** {@code jdbc:mysql://host:port/db?params} */
    private static final Pattern JDBC_URL =
            Pattern.compile("^jdbc:mysql://([^/?]+)/([^?]*)(\\?.*)?$");

    /** 同一次 JVM 里只建一次库、只播报一次。 */
    private static final Set<String> PREPARED = ConcurrentHashMap.newKeySet();
    private static final Set<String> ANNOUNCED = ConcurrentHashMap.newKeySet();

    /** 每个用例类只做一次「实际连的是哪个库」的核实；核实失败不入集合 —— 失败要每条都拦。 */
    private static final Set<String> VERIFIED = ConcurrentHashMap.newKeySet();

    // ──────────────────────────── 防线 2：目标库不合法就拒跑 ────────────────────────────

    @Override
    public ConditionEvaluationResult evaluateExecutionCondition(ExtensionContext context) {
        if (!isDatabaseTest(context)) {
            // 纯单测不连库，被跳过反而是噪声
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
            // 建不出测试库是环境问题，同样不该报红：跳过并说明
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

    // ──────────────────── 防线 3：上下文起来后，验一次「实际连的是哪个库」 ────────────────────

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
            // 驱动/连接的异常消息只有主机、用户名、库名，不含口令
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

    // ─────────────────────────────────── 判据与工具 ───────────────────────────────────

    /** 只有会去连库的用例才归门禁管。真库用例一律是 {@code @SpringBootTest}。 */
    private static boolean isDatabaseTest(ExtensionContext context) {
        return MergedAnnotations.from(context.getRequiredTestClass())
                .isPresent(SpringBootTest.class);
    }

    /** 与 {@code @EnabledIfEnvironmentVariable(named = "BILLING_DB_PASSWORD")} 同一口径。 */
    private static boolean passwordProvided() {
        return !isBlank(System.getenv("BILLING_DB_PASSWORD"));
    }

    /**
     * 测试实际会用的连接串：命令行/环境变量覆盖优先，其次读测试类路径上的
     * {@code application.properties}（Spring 也读同一份，两边不会各说各话）。
     */
    static String effectiveTestUrl() {
        String override = !isBlank(System.getProperty(URL_VAR))
                ? System.getProperty(URL_VAR) : System.getenv(URL_VAR);
        if (!isBlank(override)) {
            return override;
        }
        String configured = configuredUrl();
        return configured == null ? "" : configured;
    }

    /** 从 {@code application.properties} 取 {@code spring.datasource.url} 并解掉 {@code ${VAR:default}}。 */
    private static String configuredUrl() {
        String raw = configuredRawUrl();
        if (raw == null) {
            return null;
        }
        Matcher placeholder = PLACEHOLDER.matcher(raw.trim());
        if (!placeholder.matches()) {
            // 形态被改过（比如写死连接串）：按原样用，库名判据兜底
            return raw.trim();
        }
        String override = !isBlank(System.getProperty(placeholder.group(1)))
                ? System.getProperty(placeholder.group(1)) : System.getenv(placeholder.group(1));
        return isBlank(override) ? configuredDefaultUrl() : override;
    }

    /**
     * 配置里写死的缺省落点（不含环境覆盖）。
     * 单独拎出来给用例断言：**缺省落点本身就必须是测试专用库** ——
     * 否则「什么都没配的人」会径直跑到开发库上。
     */
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

    /** 库名（取不到就返回空串 → 一律按「不是测试专用库」处理）。 */
    static String databaseName(String url) {
        Matcher matcher = JDBC_URL.matcher(url == null ? "" : url.trim());
        return matcher.matches() ? matcher.group(2) : "";
    }

    static boolean isTestDatabase(String database) {
        return database != null && TEST_DATABASE.matcher(database).matches();
    }

    /**
     * 测试库不存在就建（幂等）；Flyway 之后会把 schema 建在里面。
     * 用不带库名的 server 连接执行 —— 这条连接**只建库、不写任何业务数据**。
     */
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
            // 库名已通过 TEST_DATABASE 校验，可安全拼接；字符集与开发库一致
            statement.executeUpdate(
                    "CREATE DATABASE IF NOT EXISTS `" + database + "` DEFAULT CHARACTER SET utf8mb4");
        } catch (SQLException error) {
            throw new IllegalStateException(
                    error.getClass().getSimpleName() + ": " + error.getMessage(), error);
        }
        // 建成功才记账：失败的那次不复用，下次求值还会重试
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
