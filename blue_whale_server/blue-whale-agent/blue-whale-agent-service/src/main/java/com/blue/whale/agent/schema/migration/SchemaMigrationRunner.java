package com.blue.whale.agent.schema.migration;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.ApplicationContext;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

/**
 * 迁移器启动钩子（IK1W1E）。
 *
 * <p>仅在 {@code blue-whale.schema-migration.enabled=true} 时装配（默认关闭）。
 * 业务服务（agent/user）不启用——Schema 就绪由 Compose
 * {@code depends_on: blue-whale-schema-migration.condition: service_completed_successfully}
 * 拓扑保证，业务代码零侵入。本 Runner 仅供独立 migration 容器使用：
 * <ul>
 *   <li>{@code migration-only} profile 下：跑完迁移后立即关闭进程（exit 0 成功 / 非 0 失败），
 *       不启动 web/业务服务。</li>
 *   <li>其他 profile：跑完迁移后继续启动（用于本地非容器场景调试，生产 Compose 不走此路径）。</li>
 * </ul>
 *
 * <p>迁移失败时抛出 {@link SchemaMigrationService.MigrationException}，Spring Boot 会让进程
 * 启动失败（exit code 非 0），实现「迁移未完成则不报告健康」的 fail-closed 语义。
 *
 * <p>测试不装配：IT 用 H2 + schema-h2.sql 自建表，迁移文件是 MySQL 方言会在 H2 失败；
 * 默认关闭让 IT 零侵入。
 */
@Component
@ConditionalOnProperty(name = "blue-whale.schema-migration.enabled", havingValue = "true")
public class SchemaMigrationRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(SchemaMigrationRunner.class);

    /** 激活后仅执行迁移并退出，不启动 web/业务服务。供 migration 容器使用。 */
    public static final String MIGRATION_ONLY_PROFILE = "migration-only";

    private final SchemaMigrationService migrationService;
    private final Environment environment;
    private final ApplicationContext applicationContext;

    public SchemaMigrationRunner(SchemaMigrationService migrationService,
                                 Environment environment,
                                 ApplicationContext applicationContext) {
        this.migrationService = migrationService;
        this.environment = environment;
        this.applicationContext = applicationContext;
    }

    @Override
    public void run(ApplicationArguments args) {
        log.info("[schema-migration] 启动迁移检查...");
        migrationService.migrate();

        if (environment.acceptsProfiles(Profiles.of(MIGRATION_ONLY_PROFILE))) {
            // 迁移成功，exit 0。compose 下游用 depends_on: service_completed_successfully 等待。
            // 迁移失败时 migrate() 抛 MigrationException，Spring Boot 让进程 exit 非 0，
            // 下游 user/agent 不启动（fail-closed 门禁）。
            log.info("[schema-migration] migration-only profile 激活，迁移完成，关闭进程（exit 0）");
            System.exit(SpringApplication.exit(applicationContext, () -> 0));
        }
    }
}
