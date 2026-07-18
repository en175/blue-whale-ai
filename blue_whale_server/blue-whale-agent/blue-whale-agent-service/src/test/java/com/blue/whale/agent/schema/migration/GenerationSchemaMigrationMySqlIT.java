package com.blue.whale.agent.schema.migration;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V4 GenerationJob/Asset 结构收敛升级的真实 MySQL 验收（IK1W1L）。
 *
 * <p>仅在显式提供专用测试库连接时运行（与 SnapshotMySqlConsistencyIT 同约定）：
 * {@code BLUE_WHALE_TEST_MYSQL_URL/USERNAME/PASSWORD}。默认环境明确跳过。
 *
 * <p>直接用生产迁移目录 {@link SchemaMigrationService#DEFAULT_MIGRATION_LOCATION}
 * （V1/V2/V3/V4/V5）驱动迁移器，覆盖：
 * <ul>
 *   <li>空库初始化后 GenerationJob/Asset 域结构齐全，重复执行幂等</li>
 *   <li>受支持旧形态（pre-ik10i6 缺表缺列、ik10i6 时代 NOT NULL 输出槽、
 *       ik10ic 时代旧唯一索引）原地升级，既有 Job/Asset/Canvas 关联保留</li>
 *   <li>无法安全识别的漂移（列类型错误、核心列缺失）fail-closed 并记录 failed</li>
 * </ul>
 * 不依赖 Spring 上下文，直接 JDBC 构造库形态并调用迁移器。
 */
@EnabledIfEnvironmentVariable(named = "BLUE_WHALE_TEST_MYSQL_URL", matches = "jdbc:mysql://.+")
@EnabledIfEnvironmentVariable(named = "BLUE_WHALE_TEST_MYSQL_USERNAME", matches = ".+")
@EnabledIfEnvironmentVariable(named = "BLUE_WHALE_TEST_MYSQL_PASSWORD", matches = ".*")
class GenerationSchemaMigrationMySqlIT {

    /** 本测试触碰的全部表（V1 全量 + 迁移器记账本），setUp/tearDown 完整清场不留残骸 */
    private static final List<String> TOUCHED_TABLES = List.of(
            "schema_migrations",
            "template_card", "template_card_image", "skill", "user_skill",
            "project", "canvas", "project_event_stream", "project_events", "outbox_messages",
            "conversations", "agent_runs", "runtime_checkpoints", "run_commits",
            "user_input_requests", "conversation_messages", "command_idempotency",
            "generation_job_outputs", "asset_storage_objects", "asset_object_transfers",
            "generation_result_conflicts", "generation_provider_tasks",
            "seedance_callback_inbox", "seedance_callback_security_audits",
            "cost_budget_locks", "cost_reservations", "audit_records",
            "generation_jobs", "assets", "content_reviews");

    /** pre-ik10i6 历史形态 generation_jobs（初始列，缺 ik10i6~ik10pt 后加列） */
    private static final String LEGACY_JOBS_PRE_IK10I6_DDL = """
            CREATE TABLE generation_jobs
            (
                id               BIGINT PRIMARY KEY AUTO_INCREMENT,
                project_id       BIGINT NULL,
                user_id          BIGINT NOT NULL,
                agent_run_id     BIGINT NULL,
                action_identity  VARCHAR(128) NULL,
                type             VARCHAR(32) NOT NULL,
                source           VARCHAR(32) NOT NULL,
                input            JSON NULL,
                status           VARCHAR(32) NOT NULL,
                progress         INT NULL,
                output_asset_ids JSON NULL,
                provider         VARCHAR(64) NULL,
                provider_task_id VARCHAR(128) NULL,
                poll_count       INT NULL,
                next_poll_at     DATETIME NULL,
                retry_count      INT NULL,
                last_polled_at   DATETIME NULL,
                error            TEXT NULL,
                stage_id         VARCHAR(64) NULL,
                gmt_create       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                gmt_modified     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                version          INT      NOT NULL DEFAULT 0,
                is_delete        TINYINT  NOT NULL DEFAULT 0,
                UNIQUE KEY uk_agent_run_action (agent_run_id, action_identity)
            ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
            """;

    /** pre-ik10i6 历史形态 assets（初始列，缺 ik10i6 归属与内容身份列） */
    private static final String LEGACY_ASSETS_PRE_IK10I6_DDL = """
            CREATE TABLE assets
            (
                id                BIGINT PRIMARY KEY AUTO_INCREMENT,
                user_id           BIGINT NOT NULL,
                type              VARCHAR(16) NOT NULL,
                storage_key       VARCHAR(512) NULL,
                url               VARCHAR(1024) NULL,
                mime              VARCHAR(128) NULL,
                size              BIGINT NULL,
                width             INT NULL,
                height            INT NULL,
                duration          INT NULL,
                source            VARCHAR(32) NOT NULL,
                status            VARCHAR(32) NOT NULL,
                gmt_create        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                gmt_modified      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                version           INT NOT NULL DEFAULT 0,
                is_delete         TINYINT NOT NULL DEFAULT 0
            ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
            """;

    private DriverManagerDataSource db;

    @BeforeEach
    void setUp() {
        db = new DriverManagerDataSource(
                System.getenv("BLUE_WHALE_TEST_MYSQL_URL"),
                System.getenv("BLUE_WHALE_TEST_MYSQL_USERNAME"),
                System.getenv("BLUE_WHALE_TEST_MYSQL_PASSWORD"));
        db.setDriverClassName("com.mysql.cj.jdbc.Driver");
        try (Connection conn = db.getConnection(); Statement st = conn.createStatement()) {
            for (String table : TOUCHED_TABLES) {
                st.execute("DROP TABLE IF EXISTS " + table);
            }
        } catch (Exception e) {
            throw new IllegalStateException("清理测试库失败", e);
        }
    }

    @AfterEach
    void tearDown() {
        try (Connection conn = db.getConnection(); Statement st = conn.createStatement()) {
            for (String table : TOUCHED_TABLES) {
                st.execute("DROP TABLE IF EXISTS " + table);
            }
        } catch (Exception e) {
            throw new IllegalStateException("收尾清理测试库失败", e);
        }
    }

    @Test
    void emptyDatabaseAppliesV1V2V3V4AndConvergesGenerationTables() {
        SchemaMigrationService service = new SchemaMigrationService(
                db, SchemaMigrationService.DEFAULT_MIGRATION_LOCATION);

        List<Integer> applied = service.migrate();

        assertThat(applied).containsExactly(1, 2, 3, 4, 5);
        for (String table : List.of(
                "generation_jobs", "generation_job_outputs", "assets",
                "asset_storage_objects", "asset_object_transfers",
                "generation_result_conflicts", "generation_provider_tasks",
                "seedance_callback_inbox", "seedance_callback_security_audits",
                "cost_budget_locks", "cost_reservations", "audit_records", "content_reviews")) {
            assertThat(tableExists(table)).as("表 %s 应存在", table).isTrue();
        }
        assertThat(columnExists("generation_jobs", "strategy_version")).isTrue();
        assertThat(columnExists("generation_jobs", "project_action_identity")).isTrue();
        assertThat(columnExists("generation_job_outputs", "status")).isTrue();
        assertThat(indexExists("generation_provider_tasks", "uk_provider_task_job_slot")).isTrue();
        // Worker 认领/重试/视频 action 扫描索引（ik10i6/id/ic 引入，V1 未并入）由 V4 补齐
        assertThat(indexExists("generation_jobs", "idx_generation_job_claim")).isTrue();
        assertThat(indexExists("generation_jobs", "idx_generation_job_retry_of")).isTrue();
        assertThat(indexExists("generation_jobs", "idx_generation_video_action")).isTrue();

        // 重复执行：无新版本、无漂移报错
        assertThat(service.migrate()).isEmpty();
        assertThat(appliedVersions()).containsExactly(1, 2, 3, 4, 5, 6);
    }

    @Test
    void legacySchemaBeforeIk10i6UpgradesInPlacePreservingFacts() {
        // 形态 A（pre-ik10i6）：generation_jobs/assets 为初始形态，其余 generation 域表全部缺失
        createProjectCanvasAndSkill();
        executeScript(LEGACY_JOBS_PRE_IK10I6_DDL + LEGACY_ASSETS_PRE_IK10I6_DDL + """
                INSERT INTO project (id, owner_id, name) VALUES (9001, 1001, 'legacy-gen-A');
                INSERT INTO canvas (id, project_id, nodes_json) VALUES
                    (8001, 9001, '[{"id":"n1","type":"image","data":{"assetId":7001}}]');
                INSERT INTO generation_jobs
                    (id, project_id, user_id, type, source, status, progress, output_asset_ids, version)
                    VALUES (6001, 9001, 1001, 'image', 'bottom_dock', 'succeeded', 100, '[7001]', 3);
                INSERT INTO assets (id, user_id, type, storage_key, url, source, status, version)
                    VALUES (7001, 1001, 'image', 'legacy/7001.png', 'https://example.com/7001.png',
                            'generated', 'normal', 2);
                """);

        SchemaMigrationService service = new SchemaMigrationService(
                db, SchemaMigrationService.DEFAULT_MIGRATION_LOCATION);
        List<Integer> applied = service.migrate();

        // 旧库补记 V1，随后 V2、V3、V4、V5 正常应用
        assertThat(applied).containsExactly(1, 2, 3, 4, 5);

        // 缺列补齐：generation_jobs 十一个后加列、assets 三个后加列
        for (String column : List.of(
                "project_action_identity", "expected_output_count", "retry_of_job_id",
                "lease_owner", "lease_expires_at", "fencing_token", "strategy_version",
                "execution_deadline_at", "evidence_reconcile_until", "next_action_at",
                "cancel_requested_at")) {
            assertThat(columnExists("generation_jobs", column)).as("generation_jobs.%s 应补齐", column).isTrue();
        }
        for (String column : List.of("project_id", "generation_job_id", "content_sha256")) {
            assertThat(columnExists("assets", column)).as("assets.%s 应补齐", column).isTrue();
        }
        // 缺表建表
        for (String table : List.of(
                "generation_job_outputs", "generation_provider_tasks",
                "asset_storage_objects", "asset_object_transfers",
                "generation_result_conflicts", "seedance_callback_inbox",
                "seedance_callback_security_audits", "cost_budget_locks",
                "cost_reservations", "audit_records", "content_reviews")) {
            assertThat(tableExists(table)).as("表 %s 应建出", table).isTrue();
        }
        // V1 契约索引补齐
        assertThat(indexExists("generation_jobs", "uk_project_action_identity")).isTrue();
        assertThat(indexExists("assets", "idx_asset_project")).isTrue();
        assertThat(indexExists("assets", "idx_asset_generation_job")).isTrue();

        // 既有事实保留：主键、聚合版本、状态、归属、内容身份不变
        assertThat(queryString("SELECT status FROM generation_jobs WHERE id = 6001")).isEqualTo("succeeded");
        assertThat(queryLong("SELECT version FROM generation_jobs WHERE id = 6001")).isEqualTo(3L);
        assertThat(queryLong("SELECT user_id FROM generation_jobs WHERE id = 6001")).isEqualTo(1001L);
        assertThat(queryLong("SELECT project_id FROM generation_jobs WHERE id = 6001")).isEqualTo(9001L);
        assertThat(queryString("SELECT output_asset_ids FROM generation_jobs WHERE id = 6001")).isEqualTo("[7001]");
        assertThat(queryLong("SELECT version FROM assets WHERE id = 7001")).isEqualTo(2L);
        assertThat(queryString("SELECT storage_key FROM assets WHERE id = 7001")).isEqualTo("legacy/7001.png");
        // Canvas→Asset 引用保持：nodes_json 仍指向同一 asset
        assertThat(queryString("SELECT nodes_json FROM canvas WHERE id = 8001")).contains("7001");

        // 输出槽回填：既有 succeeded Job 补出 slot 0 行（assets.generation_job_id 历史为空，asset_id 置 NULL）
        assertThat(queryLong(
                "SELECT COUNT(*) FROM generation_job_outputs WHERE generation_job_id = 6001 AND slot_index = 0"))
                .isEqualTo(1L);
        assertThat(queryString(
                "SELECT status FROM generation_job_outputs WHERE generation_job_id = 6001 AND slot_index = 0"))
                .isEqualTo("succeeded");

        // 重复执行：无新版本、数据不重复、版本号与终态不变
        assertThat(service.migrate()).isEmpty();
        assertThat(queryLong("SELECT COUNT(*) FROM generation_jobs")).isEqualTo(1L);
        assertThat(queryLong("SELECT COUNT(*) FROM generation_job_outputs")).isEqualTo(1L);
        assertThat(queryLong("SELECT COUNT(*) FROM assets")).isEqualTo(1L);
        assertThat(queryLong("SELECT version FROM generation_jobs WHERE id = 6001")).isEqualTo(3L);
        assertThat(queryString("SELECT status FROM generation_jobs WHERE id = 6001")).isEqualTo("succeeded");
    }

    @Test
    void legacySchemaWithNotNullOutputsRelaxesAndBackfillsAssetLink() {
        // 形态 B（ik10i6 后、ik10ic 前）：jobs/assets 有 ik10i6 列，
        // outputs 为 NOT NULL 旧形态且无 status/error，provider_tasks 等表尚不存在
        createProjectCanvasAndSkill();
        executeScript("""
                CREATE TABLE generation_jobs
                (
                    id               BIGINT PRIMARY KEY AUTO_INCREMENT,
                    project_id       BIGINT NULL,
                    user_id          BIGINT NOT NULL,
                    agent_run_id     BIGINT NULL,
                    action_identity  VARCHAR(128) NULL,
                    type             VARCHAR(32) NOT NULL,
                    source           VARCHAR(32) NOT NULL,
                    input            JSON NULL,
                    status           VARCHAR(32) NOT NULL,
                    progress         INT NULL,
                    output_asset_ids JSON NULL,
                    provider         VARCHAR(64) NULL,
                    provider_task_id VARCHAR(128) NULL,
                    poll_count       INT NULL,
                    next_poll_at     DATETIME NULL,
                    retry_count      INT NULL,
                    last_polled_at   DATETIME NULL,
                    error            TEXT NULL,
                    stage_id         VARCHAR(64) NULL,
                    lease_owner      VARCHAR(128) NULL,
                    lease_expires_at DATETIME NULL,
                    fencing_token    BIGINT NOT NULL DEFAULT 0,
                    gmt_create       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    gmt_modified     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    version          INT      NOT NULL DEFAULT 0,
                    is_delete        TINYINT  NOT NULL DEFAULT 0,
                    UNIQUE KEY uk_agent_run_action (agent_run_id, action_identity),
                    INDEX idx_generation_job_claim (source, type, status, lease_expires_at, is_delete, id)
                ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
                CREATE TABLE assets
                (
                    id                BIGINT PRIMARY KEY AUTO_INCREMENT,
                    project_id        BIGINT NULL,
                    user_id           BIGINT NOT NULL,
                    generation_job_id BIGINT NULL,
                    type              VARCHAR(16) NOT NULL,
                    storage_key       VARCHAR(512) NULL,
                    content_sha256    VARCHAR(64) NULL,
                    url               VARCHAR(1024) NULL,
                    mime              VARCHAR(128) NULL,
                    size              BIGINT NULL,
                    width             INT NULL,
                    height            INT NULL,
                    duration          INT NULL,
                    source            VARCHAR(32) NOT NULL,
                    status            VARCHAR(32) NOT NULL,
                    gmt_create        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    gmt_modified      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    version           INT NOT NULL DEFAULT 0,
                    is_delete         TINYINT NOT NULL DEFAULT 0,
                    INDEX idx_asset_project (project_id, id),
                    INDEX idx_asset_generation_job (generation_job_id)
                ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
                CREATE TABLE generation_job_outputs
                (
                    id BIGINT PRIMARY KEY AUTO_INCREMENT,
                    generation_job_id BIGINT NOT NULL,
                    slot_index INT NOT NULL,
                    asset_id BIGINT NOT NULL,
                    delivery_id VARCHAR(128) NOT NULL,
                    content_sha256 VARCHAR(64) NOT NULL,
                    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    version INT NOT NULL DEFAULT 0,
                    is_delete TINYINT NOT NULL DEFAULT 0,
                    UNIQUE KEY uk_generation_output_slot (generation_job_id, slot_index),
                    UNIQUE KEY uk_generation_output_delivery (generation_job_id, delivery_id)
                ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
                CREATE TABLE generation_result_conflicts
                (
                    id BIGINT PRIMARY KEY AUTO_INCREMENT,
                    generation_job_id BIGINT NOT NULL,
                    slot_index INT NOT NULL,
                    attempted_delivery_id VARCHAR(128) NOT NULL,
                    expected_content_sha256 VARCHAR(64) NOT NULL,
                    actual_content_sha256 VARCHAR(64) NOT NULL,
                    reason VARCHAR(64) NOT NULL,
                    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    version INT NOT NULL DEFAULT 0,
                    is_delete TINYINT NOT NULL DEFAULT 0,
                    INDEX idx_generation_result_conflict (generation_job_id, slot_index)
                ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
                INSERT INTO project (id, owner_id, name) VALUES (9001, 1001, 'legacy-gen-B');
                INSERT INTO generation_jobs
                    (id, project_id, user_id, type, source, status, progress, version)
                    VALUES (6001, 9001, 1001, 'image', 'bottom_dock', 'succeeded', 100, 5),
                           (6002, 9001, 1001, 'image', 'bottom_dock', 'succeeded', 100, 1);
                INSERT INTO assets
                    (id, project_id, user_id, generation_job_id, type, storage_key, content_sha256,
                     source, status, version)
                    VALUES (7001, 9001, 1001, 6001, 'image', 'legacy/b-7001.png', REPEAT('a', 64),
                            'generated', 'normal', 4),
                           (7002, 9001, 1001, 6002, 'image', 'legacy/b-7002.png', REPEAT('b', 64),
                            'generated', 'normal', 1);
                INSERT INTO generation_job_outputs
                    (id, generation_job_id, slot_index, asset_id, delivery_id, content_sha256, version)
                    VALUES (5001, 6001, 0, 7001, 'delivery-6001-0', REPEAT('a', 64), 7);
                """);

        SchemaMigrationService service = new SchemaMigrationService(
                db, SchemaMigrationService.DEFAULT_MIGRATION_LOCATION);
        List<Integer> applied = service.migrate();

        assertThat(applied).containsExactly(1, 2, 3, 4, 5);

        // NOT NULL 三列放宽为 V1 契约的可空形态
        assertThat(columnNullable("generation_job_outputs", "asset_id")).isTrue();
        assertThat(columnNullable("generation_job_outputs", "delivery_id")).isTrue();
        assertThat(columnNullable("generation_job_outputs", "content_sha256")).isTrue();
        // ik10id 列补齐
        assertThat(columnExists("generation_job_outputs", "status")).isTrue();
        assertThat(columnExists("generation_job_outputs", "error")).isTrue();
        // jobs 补 ik10ic/ik10id/ik10pt 列
        for (String column : List.of(
                "project_action_identity", "expected_output_count", "retry_of_job_id",
                "strategy_version", "execution_deadline_at", "evidence_reconcile_until",
                "next_action_at", "cancel_requested_at")) {
            assertThat(columnExists("generation_jobs", column)).as("generation_jobs.%s 应补齐", column).isTrue();
        }

        // 既有输出行保留：主键、版本、Job→Asset 绑定不变，状态被修正为 succeeded
        assertThat(queryLong("SELECT asset_id FROM generation_job_outputs WHERE id = 5001")).isEqualTo(7001L);
        assertThat(queryLong("SELECT version FROM generation_job_outputs WHERE id = 5001")).isEqualTo(7L);
        assertThat(queryString("SELECT status FROM generation_job_outputs WHERE id = 5001")).isEqualTo("succeeded");
        assertThat(queryString("SELECT delivery_id FROM generation_job_outputs WHERE id = 5001"))
                .isEqualTo("delivery-6001-0");

        // 回填：既有 succeeded Job 6002 补出 slot 0，且指向其既有 Asset 7002（关系回填）
        assertThat(queryLong(
                "SELECT asset_id FROM generation_job_outputs WHERE generation_job_id = 6002 AND slot_index = 0"))
                .isEqualTo(7002L);
        assertThat(queryString(
                "SELECT status FROM generation_job_outputs WHERE generation_job_id = 6002 AND slot_index = 0"))
                .isEqualTo("succeeded");

        // 既有 Job/Asset 事实保留
        assertThat(queryLong("SELECT version FROM generation_jobs WHERE id = 6001")).isEqualTo(5L);
        assertThat(queryLong("SELECT version FROM assets WHERE id = 7001")).isEqualTo(4L);
        assertThat(queryLong("SELECT generation_job_id FROM assets WHERE id = 7002")).isEqualTo(6002L);

        // 重复执行：输出行不重复、状态不回头
        assertThat(service.migrate()).isEmpty();
        assertThat(queryLong("SELECT COUNT(*) FROM generation_job_outputs")).isEqualTo(2L);
        assertThat(queryString("SELECT status FROM generation_job_outputs WHERE id = 5001")).isEqualTo("succeeded");
    }

    @Test
    void legacySchemaWithOldProviderTaskUniqueKeyConverges() {
        // 形态 C（ik10ic 后、ik10id 前）：provider_tasks 带旧唯一索引 uk_provider_task_job（每 job 一行）、
        // 无 slot_index；jobs 有 ik10i6+ik10ic 列、无 ik10id/ik10pt 列
        createProjectCanvasAndSkill();
        executeScript("""
                CREATE TABLE generation_jobs
                (
                    id               BIGINT PRIMARY KEY AUTO_INCREMENT,
                    project_id       BIGINT NULL,
                    user_id          BIGINT NOT NULL,
                    agent_run_id     BIGINT NULL,
                    action_identity  VARCHAR(128) NULL,
                    type             VARCHAR(32) NOT NULL,
                    source           VARCHAR(32) NOT NULL,
                    input            JSON NULL,
                    status           VARCHAR(32) NOT NULL,
                    progress         INT NULL,
                    output_asset_ids JSON NULL,
                    provider         VARCHAR(64) NULL,
                    provider_task_id VARCHAR(128) NULL,
                    poll_count       INT NULL,
                    next_poll_at     DATETIME NULL,
                    retry_count      INT NULL,
                    last_polled_at   DATETIME NULL,
                    error            TEXT NULL,
                    stage_id         VARCHAR(64) NULL,
                    lease_owner      VARCHAR(128) NULL,
                    lease_expires_at DATETIME NULL,
                    fencing_token    BIGINT NOT NULL DEFAULT 0,
                    strategy_version VARCHAR(64) NULL,
                    execution_deadline_at DATETIME NULL,
                    evidence_reconcile_until DATETIME NULL,
                    next_action_at DATETIME NULL,
                    cancel_requested_at DATETIME NULL,
                    gmt_create       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    gmt_modified     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    version          INT      NOT NULL DEFAULT 0,
                    is_delete        TINYINT  NOT NULL DEFAULT 0,
                    UNIQUE KEY uk_agent_run_action (agent_run_id, action_identity)
                ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
                CREATE TABLE generation_job_outputs
                (
                    id BIGINT PRIMARY KEY AUTO_INCREMENT,
                    generation_job_id BIGINT NOT NULL,
                    slot_index INT NOT NULL,
                    asset_id BIGINT NULL,
                    delivery_id VARCHAR(128) NULL,
                    content_sha256 VARCHAR(64) NULL,
                    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    version INT NOT NULL DEFAULT 0,
                    is_delete TINYINT NOT NULL DEFAULT 0,
                    UNIQUE KEY uk_generation_output_slot (generation_job_id, slot_index),
                    UNIQUE KEY uk_generation_output_delivery (generation_job_id, delivery_id)
                ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
                CREATE TABLE generation_provider_tasks
                (
                    id BIGINT PRIMARY KEY AUTO_INCREMENT,
                    generation_job_id BIGINT NOT NULL,
                    provider VARCHAR(64) NOT NULL,
                    account_id VARCHAR(128) NOT NULL,
                    provider_task_id VARCHAR(128) NULL,
                    submission_state VARCHAR(32) NOT NULL,
                    provider_status VARCHAR(32) NULL,
                    callback_capability_digest VARCHAR(64) NOT NULL,
                    raw_status VARCHAR(64) NULL,
                    raw_error_code VARCHAR(128) NULL,
                    raw_error_message TEXT NULL,
                    temporary_result_url VARCHAR(2048) NULL,
                    observe_count INT NOT NULL DEFAULT 0,
                    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    version INT NOT NULL DEFAULT 0,
                    is_delete TINYINT NOT NULL DEFAULT 0,
                    UNIQUE KEY uk_provider_task_job (generation_job_id),
                    UNIQUE KEY uk_provider_task_ref (provider, account_id, provider_task_id)
                ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
                CREATE TABLE assets
                (
                    id                BIGINT PRIMARY KEY AUTO_INCREMENT,
                    project_id        BIGINT NULL,
                    user_id           BIGINT NOT NULL,
                    generation_job_id BIGINT NULL,
                    type              VARCHAR(16) NOT NULL,
                    storage_key       VARCHAR(512) NULL,
                    content_sha256    VARCHAR(64) NULL,
                    url               VARCHAR(1024) NULL,
                    mime              VARCHAR(128) NULL,
                    size              BIGINT NULL,
                    width             INT NULL,
                    height            INT NULL,
                    duration          INT NULL,
                    source            VARCHAR(32) NOT NULL,
                    status            VARCHAR(32) NOT NULL,
                    gmt_create        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    gmt_modified      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    version           INT NOT NULL DEFAULT 0,
                    is_delete         TINYINT NOT NULL DEFAULT 0,
                    INDEX idx_asset_project (project_id, id),
                    INDEX idx_asset_generation_job (generation_job_id)
                ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
                INSERT INTO project (id, owner_id, name) VALUES (9001, 1001, 'legacy-gen-C');
                INSERT INTO generation_jobs
                    (id, project_id, user_id, type, source, status, progress, version)
                    VALUES (6001, 9001, 1001, 'video', 'agent_run', 'running', 40, 9);
                INSERT INTO generation_provider_tasks
                    (id, generation_job_id, provider, account_id, provider_task_id,
                     submission_state, callback_capability_digest, version)
                    VALUES (3001, 6001, 'seedance', 'acct-1', 'task-xyz', 'submitted', REPEAT('c', 64), 2);
                """);

        SchemaMigrationService service = new SchemaMigrationService(
                db, SchemaMigrationService.DEFAULT_MIGRATION_LOCATION);
        List<Integer> applied = service.migrate();

        assertThat(applied).containsExactly(1, 2, 3, 4, 5);

        // 旧唯一索引被丢弃，多输出契约的新唯一索引与 slot_index 列就位
        assertThat(indexExists("generation_provider_tasks", "uk_provider_task_job")).isFalse();
        assertThat(indexExists("generation_provider_tasks", "uk_provider_task_job_slot")).isTrue();
        assertThat(columnExists("generation_provider_tasks", "slot_index")).isTrue();
        // jobs 补 ik10id/ik10pt 列
        for (String column : List.of(
                "project_action_identity", "expected_output_count", "retry_of_job_id")) {
            assertThat(columnExists("generation_jobs", column)).as("generation_jobs.%s 应补齐", column).isTrue();
        }

        // 既有供应商证据行保留，slot_index 落默认值 0，运行中状态不被触碰
        assertThat(queryLong("SELECT slot_index FROM generation_provider_tasks WHERE id = 3001")).isEqualTo(0L);
        assertThat(queryLong("SELECT version FROM generation_provider_tasks WHERE id = 3001")).isEqualTo(2L);
        assertThat(queryString("SELECT submission_state FROM generation_provider_tasks WHERE id = 3001"))
                .isEqualTo("submitted");
        assertThat(queryString("SELECT status FROM generation_jobs WHERE id = 6001")).isEqualTo("running");
        assertThat(queryLong("SELECT version FROM generation_jobs WHERE id = 6001")).isEqualTo(9L);

        // 重复执行幂等
        assertThat(service.migrate()).isEmpty();
        assertThat(queryLong("SELECT COUNT(*) FROM generation_provider_tasks")).isEqualTo(1L);
    }

    @Test
    void unknownColumnTypeDriftFailsClosed() {
        // 无法安全识别的漂移：形态与 pre-ik10i6 一致，但 generation_jobs.user_id 应为 bigint 却是 varchar
        createProjectCanvasAndSkill();
        executeScript(LEGACY_JOBS_PRE_IK10I6_DDL.replace(
                "user_id          BIGINT NOT NULL", "user_id          VARCHAR(64) NOT NULL")
                + LEGACY_ASSETS_PRE_IK10I6_DDL + """
                INSERT INTO project (id, owner_id, name) VALUES (9001, 1001, 'legacy-drift-type');
                """);

        SchemaMigrationService service = new SchemaMigrationService(
                db, SchemaMigrationService.DEFAULT_MIGRATION_LOCATION);

        assertThatThrownBy(service::migrate)
                .isInstanceOf(SchemaMigrationService.MigrationException.class)
                .hasMessageContaining("V4")
                .hasMessageContaining("漂移");
        // fail-closed：V4 记录 failed，不允许跳过失败版本静默成功
        assertThat(failedVersions()).contains(4);
    }

    @Test
    void missingCoreColumnFailsClosed() {
        // 无法安全识别的漂移：核心列 status 缺失（不属于任何受支持历史形态）
        createProjectCanvasAndSkill();
        executeScript(LEGACY_JOBS_PRE_IK10I6_DDL.replace(
                "    status           VARCHAR(32) NOT NULL,\n", "")
                + LEGACY_ASSETS_PRE_IK10I6_DDL + """
                INSERT INTO project (id, owner_id, name) VALUES (9001, 1001, 'legacy-drift-missing');
                """);

        SchemaMigrationService service = new SchemaMigrationService(
                db, SchemaMigrationService.DEFAULT_MIGRATION_LOCATION);

        assertThatThrownBy(service::migrate)
                .isInstanceOf(SchemaMigrationService.MigrationException.class)
                .hasMessageContaining("V4")
                .hasMessageContaining("漂移");
        assertThat(failedVersions()).contains(4);
    }

    // ===== 夹具与工具 =====

    /** 非本域但迁移链必需的表：project（旧库判定）、canvas（关联断言）、skill（V2 seed 依赖） */
    private void createProjectCanvasAndSkill() {
        executeScript("""
                CREATE TABLE project
                (
                    id           BIGINT PRIMARY KEY AUTO_INCREMENT,
                    owner_id     BIGINT       NOT NULL,
                    name         VARCHAR(128) NOT NULL,
                    thumb        VARCHAR(512) NULL,
                    gmt_create   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    gmt_modified DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    version      INT          NOT NULL DEFAULT 0,
                    is_delete    TINYINT      NOT NULL DEFAULT 0,
                    INDEX idx_project_owner (owner_id)
                ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
                CREATE TABLE canvas
                (
                    id            BIGINT PRIMARY KEY AUTO_INCREMENT,
                    project_id    BIGINT       NOT NULL,
                    viewport_json JSON NULL,
                    nodes_json    JSON NULL,
                    gmt_create    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    gmt_modified  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    version       INT          NOT NULL DEFAULT 0,
                    is_delete     TINYINT      NOT NULL DEFAULT 0,
                    UNIQUE KEY uk_canvas_project (project_id)
                ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
                CREATE TABLE skill
                (
                    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
                    name        VARCHAR(255) NOT NULL,
                    description TEXT         NULL,
                    content     LONGTEXT     NULL,
                    source      VARCHAR(32)  NOT NULL DEFAULT 'official',
                    sort_order  INT          NOT NULL DEFAULT 0,
                    cover_url   VARCHAR(512) NULL,
                    gmt_create  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    gmt_modified DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    version     INT          NOT NULL DEFAULT 0,
                    is_delete   TINYINT      NOT NULL DEFAULT 0,
                    UNIQUE INDEX uk_name (name),
                    INDEX idx_sort (sort_order)
                ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
                """);
    }

    /** 复用迁移器的语句拆分（同包），逐条执行夹具脚本 */
    private void executeScript(String sql) {
        try (Connection conn = db.getConnection(); Statement st = conn.createStatement()) {
            for (String stmt : SchemaMigrationService.splitStatements(sql)) {
                if (!stmt.isBlank()) {
                    st.execute(stmt);
                }
            }
        } catch (Exception e) {
            throw new IllegalStateException("夹具执行失败: " + e.getMessage(), e);
        }
    }

    private boolean tableExists(String table) {
        return queryLong("SELECT COUNT(*) FROM information_schema.TABLES "
                + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '" + table + "'") == 1L;
    }

    private boolean columnExists(String table, String column) {
        return queryLong("SELECT COUNT(*) FROM information_schema.COLUMNS "
                + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '" + table
                + "' AND COLUMN_NAME = '" + column + "'") == 1L;
    }

    private boolean columnNullable(String table, String column) {
        return "YES".equals(queryString("SELECT IS_NULLABLE FROM information_schema.COLUMNS "
                + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '" + table
                + "' AND COLUMN_NAME = '" + column + "'"));
    }

    private boolean indexExists(String table, String index) {
        return queryLong("SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS "
                + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '" + table
                + "' AND INDEX_NAME = '" + index + "'") == 1L;
    }

    private List<Integer> appliedVersions() {
        return queryVersions(1);
    }

    private List<Integer> failedVersions() {
        return queryVersions(0);
    }

    private List<Integer> queryVersions(int status) {
        try (Connection conn = db.getConnection();
             Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery(
                     "SELECT version FROM schema_migrations WHERE status=" + status + " ORDER BY version")) {
            List<Integer> out = new ArrayList<>();
            while (rs.next()) {
                out.add(rs.getInt(1));
            }
            return out;
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private long queryLong(String sql) {
        Object value = querySingle(sql);
        return value == null ? -1L : ((Number) value).longValue();
    }

    private String queryString(String sql) {
        Object value = querySingle(sql);
        return value == null ? null : value.toString();
    }

    private Object querySingle(String sql) {
        try (Connection conn = db.getConnection();
             Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery(sql)) {
            return rs.next() ? rs.getObject(1) : null;
        } catch (Exception e) {
            throw new IllegalStateException("查询失败: " + sql, e);
        }
    }
}
