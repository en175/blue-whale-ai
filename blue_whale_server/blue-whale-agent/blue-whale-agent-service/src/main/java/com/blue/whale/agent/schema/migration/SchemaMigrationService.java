package com.blue.whale.agent.schema.migration;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.core.io.support.ResourcePatternResolver;
import org.springframework.stereotype.Component;
import org.springframework.util.DigestUtils;

import javax.sql.DataSource;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 版本化数据库迁移器（IK1W1E）。
 *
 * <p>单一权威入口：扫描 classpath {@code db/migrations/V<数字>__<slug>.sql}，按版本号顺序应用，
 * 在 {@code schema_migrations} 表持久记录已应用版本、checksum 与状态。空库初始化与旧库升级
 * 共享同一入口；旧库（记账本为空但基线表已存在）自动补记 V1，不重跑 CREATE，不删数据。
 *
 * <p>失败即停（fail-closed）：任意版本执行失败，记 status=failed 并抛出异常，进程不应以
 * 「健康」状态继续提供部分功能。幂等：已应用版本跳过；可重复启动。
 */
@Component
@ConditionalOnProperty(name = "blue-whale.schema-migration.enabled", havingValue = "true")
public class SchemaMigrationService {

    private static final Logger log = LoggerFactory.getLogger(SchemaMigrationService.class);

    /** 默认迁移文件 classpath 前缀 */
    public static final String DEFAULT_MIGRATION_LOCATION = "classpath:db/migrations/V*__*.sql";

    /** 记账本表名 */
    private static final String MIGRATIONS_TABLE = "schema_migrations";

    /** 旧库判定用的基线表（存在则视为 V1 基线已落地） */
    private static final String BASELINE_TABLE = "project";

    /** 记账本 status 字段：1=applied，0=failed */
    enum Status {
        FAILED(0),
        APPLIED(1);

        final int code;

        Status(int code) {
            this.code = code;
        }
    }

    private final DataSource dataSource;
    private final ResourcePatternResolver resourceResolver;
    private final String migrationLocation;

    /** 生产构造：用默认 classpath:db/migrations/V*__*.sql */
    @org.springframework.beans.factory.annotation.Autowired
    public SchemaMigrationService(DataSource dataSource) {
        this(dataSource, DEFAULT_MIGRATION_LOCATION);
    }

    /** 指定迁移文件 location（测试用，避免与生产 db/migrations 混合） */
    public SchemaMigrationService(DataSource dataSource, String migrationLocation) {
        this.dataSource = dataSource;
        this.resourceResolver = new PathMatchingResourcePatternResolver();
        this.migrationLocation = migrationLocation;
    }

    /**
     * 执行迁移。返回已应用的新版本号列表（已应用过的版本不包含在内）。
     *
     * @throws MigrationException 任何版本失败时抛出，调用方应让进程以非 0 退出
     */
    public List<Integer> migrate() {
        List<MigrationFile> files = discoverMigrations();
        log.info("[schema-migration] 发现 {} 个迁移版本: {}", files.size(),
                files.stream().map(f -> "V" + f.version).toList());

        try (Connection conn = dataSource.getConnection()) {
            ensureMigrationsTable(conn);
            boolean baselineTableExists = tableExists(conn, BASELINE_TABLE);
            boolean ledgerEmpty = ledgerIsEmpty(conn);

            List<Integer> newlyApplied = new ArrayList<>();
            for (MigrationFile mf : files) {
                Integer status = appliedStatus(conn, mf.version);
                if (status != null) {
                    if (status == Status.APPLIED.code) {
                        // IK1W1E Acceptance #3：校验不一致 fail-closed。
                        // 比对记账本 checksum 与当前文件 checksum，不一致说明迁移文件被篡改
                        // 或记账本与代码版本不匹配——明确失败而非静默跳过。
                        String recorded = appliedChecksum(conn, mf.version);
                        if (!mf.checksum.equals(recorded)) {
                            throw new MigrationException(
                                    "V" + mf.version + " 校验不一致：记账本 checksum=" + recorded
                                            + "，当前文件 checksum=" + mf.checksum
                                            + "。迁移文件可能被篡改或与记账本版本不匹配，"
                                            + "需人工核对后修正 db/migrations 或清理 "
                                            + MIGRATIONS_TABLE + " 中该版本记录");
                        }
                        log.info("[schema-migration] V{} 已应用（checksum 校验通过），跳过", mf.version);
                    } else {
                        // 历史失败记录：不允许跳过失败版本，必须修复后重跑
                        throw new MigrationException(
                                "V" + mf.version + " 之前执行失败（status=failed），需人工修复后清理 "
                                        + MIGRATIONS_TABLE + " 中的失败记录再重试");
                    }
                    continue;
                }

                // 旧库补记：记账本空 + 基线表存在 + 当前是 V1 → 不重跑 SQL，直接补记
                if (mf.version == 1 && ledgerEmpty && baselineTableExists) {
                    log.info("[schema-migration] 检测到旧库（{} 表已存在、记账本为空），补记 V1（不重跑 DDL）",
                            BASELINE_TABLE);
                    recordApplied(conn, mf);
                    newlyApplied.add(mf.version);
                    continue;
                }

                log.info("[schema-migration] 应用 V{}: {}", mf.version, mf.slug);
                applyFile(conn, mf);
                recordApplied(conn, mf);
                newlyApplied.add(mf.version);
                log.info("[schema-migration] V{} 完成", mf.version);
            }

            log.info("[schema-migration] 迁移完成，本轮新应用 {} 个版本", newlyApplied.size());
            return newlyApplied;
        } catch (MigrationException e) {
            throw e;
        } catch (Exception e) {
            throw new MigrationException("迁移执行失败: " + e.getMessage(), e);
        }
    }

    /** 扫描并解析迁移文件，按版本号升序 */
    private List<MigrationFile> discoverMigrations() {
        Resource[] resources;
        try {
            resources = resourceResolver.getResources(migrationLocation);
        } catch (java.io.FileNotFoundException fnf) {
            // 目录不存在（如空 classpath 前缀）：视为无迁移文件，让后续校验报错
            resources = new Resource[0];
        } catch (Exception e) {
            throw new MigrationException("扫描迁移文件失败: " + e.getMessage(), e);
        }
        List<MigrationFile> files = new ArrayList<>();
        for (Resource r : resources) {
            String name = r.getFilename();
            MigrationFile mf = parseFilename(name);
            if (mf == null) {
                continue;
            }
            String content;
            try (InputStream in = r.getInputStream()) {
                content = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            } catch (Exception e) {
                throw new MigrationException("读取迁移文件 " + name + " 失败: " + e.getMessage(), e);
            }
            mf.content = content;
            mf.checksum = DigestUtils.md5DigestAsHex(content.getBytes(StandardCharsets.UTF_8));
            files.add(mf);
        }
        files.sort(Comparator.comparingInt(f -> f.version));
        if (files.isEmpty()) {
            throw new MigrationException("未发现任何迁移文件，检查 db/migrations/V*__*.sql 是否在 classpath");
        }
        // 版本号唯一性校验
        for (int i = 1; i < files.size(); i++) {
            if (files.get(i).version == files.get(i - 1).version) {
                throw new MigrationException("重复的迁移版本号 V" + files.get(i).version);
            }
        }
        return files;
    }

    /** 解析 V<数字>__<slug>.sql 文件名；不匹配返回 null */
    private MigrationFile parseFilename(String name) {
        if (name == null || !name.endsWith(".sql")) {
            return null;
        }
        String base = name.substring(0, name.length() - 4);
        int sep = base.indexOf("__");
        if (sep <= 0 || !base.startsWith("V")) {
            return null;
        }
        try {
            int version = Integer.parseInt(base.substring(1, sep));
            String slug = base.substring(sep + 2);
            return new MigrationFile(version, slug, name);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private void ensureMigrationsTable(Connection conn) throws Exception {
        String ddl = "CREATE TABLE IF NOT EXISTS " + MIGRATIONS_TABLE + " ("
                + "version INT PRIMARY KEY,"
                + "slug VARCHAR(128) NOT NULL,"
                + "checksum VARCHAR(64) NOT NULL,"
                + "status TINYINT NOT NULL,"  // Status.code：1=APPLIED, 0=FAILED
                + "applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
                + ")";
        try (Statement st = conn.createStatement()) {
            st.execute(ddl);
        }
    }

    private boolean tableExists(Connection conn, String tableName) throws Exception {
        try (ResultSet rs = conn.getMetaData().getTables(
                conn.getCatalog(), null, tableName, new String[]{"TABLE"})) {
            return rs.next();
        }
    }

    private boolean ledgerIsEmpty(Connection conn) throws Exception {
        try (Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery("SELECT COUNT(*) FROM " + MIGRATIONS_TABLE)) {
            return rs.next() && rs.getInt(1) == 0;
        }
    }

    /** 返回版本的 status（APPLIED.code / FAILED.code）；未记录返回 null */
    private Integer appliedStatus(Connection conn, int version) throws Exception {
        return queryVersionField(conn, version, "status", rs -> rs.getInt(1));
    }

    /** 返回记账本中该版本记录的 checksum；未记录返回 null */
    private String appliedChecksum(Connection conn, int version) throws Exception {
        return queryVersionField(conn, version, "checksum", rs -> rs.getString(1));
    }

    /**
     * 查询记账本中某版本的指定列。未记录返回 null。
     *
     * @param extractor 从 ResultSet 第一行提取目标列值
     */
    private <T> T queryVersionField(Connection conn, int version, String column,
                                    ResultSetExtractor<T> extractor) throws Exception {
        try (PreparedStatement ps = conn.prepareStatement(
                "SELECT " + column + " FROM " + MIGRATIONS_TABLE + " WHERE version = ?")) {
            ps.setInt(1, version);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    return extractor.extract(rs);
                }
            }
        }
        return null;
    }

    /** 从 ResultSet 提取单列值 */
    @FunctionalInterface
    interface ResultSetExtractor<T> {
        T extract(ResultSet rs) throws Exception;
    }

    /**
     * 执行迁移文件 SQL。按分号拆分逐条执行，失败抛出并回滚当前事务。
     *
     * <p>注意：MySQL 的 DDL（CREATE/ALTER）会隐式提交，rollback 无法撤销已执行的 DDL。
     * 当前迁移文件均为幂等 DDL（CREATE TABLE IF NOT EXISTS）或幂等 INSERT（INSERT IGNORE），
     * 失败重跑安全；事务回滚主要保护记账本的 INSERT 与迁移 SQL 在同一原子边界内。
     */
    private void applyFile(Connection conn, MigrationFile mf) throws Exception {
        conn.setAutoCommit(false);
        try {
            for (String stmt : splitStatements(mf.content)) {
                if (stmt.isBlank()) {
                    continue;
                }
                try (Statement st = conn.createStatement()) {
                    st.execute(stmt);
                }
            }
            conn.commit();
        } catch (Exception e) {
            conn.rollback();
            recordFailed(conn, mf);
            throw new MigrationException(
                    "V" + mf.version + " (" + mf.slug + ") 执行失败: " + e.getMessage(), e);
        } finally {
            conn.setAutoCommit(true);
        }
    }

    /**
     * 按分号拆分 SQL 语句。简单实现：忽略单引号字符串内的分号。
     * 迁移文件均为 DDL/幂等 INSERT，无存储过程，此拆分足够。
     */
    static List<String> splitStatements(String sql) {
        List<String> stmts = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean inSingleQuote = false;
        for (int i = 0; i < sql.length(); i++) {
            char c = sql.charAt(i);
            cur.append(c);
            if (c == '\'') {
                inSingleQuote = !inSingleQuote;
            } else if (c == ';' && !inSingleQuote) {
                stmts.add(cur.toString());
                cur.setLength(0);
            }
        }
        if (!cur.isEmpty()) {
            stmts.add(cur.toString());
        }
        return stmts;
    }

    private void recordApplied(Connection conn, MigrationFile mf) throws Exception {
        try (PreparedStatement ps = conn.prepareStatement(
                "INSERT INTO " + MIGRATIONS_TABLE
                        + " (version, slug, checksum, status) VALUES (?, ?, ?, ?)")) {
            ps.setInt(1, mf.version);
            ps.setString(2, mf.slug);
            ps.setString(3, mf.checksum);
            ps.setInt(4, Status.APPLIED.code);
            ps.executeUpdate();
        }
    }

    private void recordFailed(Connection conn, MigrationFile mf) {
        // 失败记录用独立事务（外层已回滚），便于诊断。先删后插，避免 REPLACE 方言差异。
        try (PreparedStatement del = conn.prepareStatement(
                "DELETE FROM " + MIGRATIONS_TABLE + " WHERE version = ?");
             PreparedStatement ins = conn.prepareStatement(
                     "INSERT INTO " + MIGRATIONS_TABLE
                             + " (version, slug, checksum, status) VALUES (?, ?, ?, ?)")) {
            del.setInt(1, mf.version);
            del.executeUpdate();
            ins.setInt(1, mf.version);
            ins.setString(2, mf.slug);
            ins.setString(3, mf.checksum);
            ins.setInt(4, Status.FAILED.code);
            ins.executeUpdate();
            conn.commit();
        } catch (Exception e) {
            // 记录失败信息本身失败不应掩盖原始迁移错误，但需留痕便于诊断记账表故障
            log.warn("[schema-migration] 记录 V{} 失败状态到记账本时出错: {}", mf.version, e.getMessage());
        }
    }

    /** 迁移文件元数据 */
    static class MigrationFile {
        final int version;
        final String slug;
        final String filename;
        String content;
        String checksum;

        MigrationFile(int version, String slug, String filename) {
            this.version = version;
            this.slug = slug;
            this.filename = filename;
        }
    }

    /** 迁移异常：调用方捕获后应让进程 fail-closed */
    public static class MigrationException extends RuntimeException {
        public MigrationException(String message) {
            super(message);
        }

        public MigrationException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
