package com.bluewhale.worker.infrastructure.mapper;

import com.bluewhale.worker.domain.entity.MaterialAssetEntity;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.extension.spring.MybatisSqlSessionFactoryBean;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.mapper.MapperFactoryBean;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;

import javax.sql.DataSource;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 素材状态跟进 SQL 真库集成测试（ADR-0087 决策 4）。
 * <p>
 * 为什么必须有这一层：{@code MaterialStatusPollerTest} 把 mapper 全 mock 掉了——
 * `listProcessingWithin` 的窗口表达式（`DATE_SUB(NOW(), INTERVAL ? MINUTE)`）或
 * `mirrorStatus` 的 WHERE 谓词写错，单测一条都不会红，而表现是「跟进器静默什么都不做」。
 * 这里跑真 MySQL，把 DDL 与 SQL 一起钉住。
 * <p>
 * 接线沿用 {@code JobStateMachineMySqlIntegrationTest}：手动 ApplicationContext，
 * 只注册本测试需要的两个 Mapper（不扫 autoconfig / 不起 MQ / 不起 @Scheduled）。
 */
@Testcontainers(disabledWithoutDocker = true)
@DisplayName("素材状态跟进 SQL 真库集成测试（MySQL Testcontainers）")
class MaterialAssetMapperMySqlIntegrationTest {

    @Container
    static final MySQLContainer<?> mysql = new MySQLContainer<>(DockerImageName.parse("mysql:8.0"))
            .withDatabaseName("bluewhale_test")
            .withUsername("test")
            .withPassword("test")
            .withCommand("--default-time-zone=+00:00")
            .withCopyFileToContainer(
                    MountableFile.forClasspathResource("db/bluewhale-schema.sql"),
                    "/docker-entrypoint-initdb.d/init.sql")
            .withStartupTimeout(Duration.ofMinutes(5))
            .withReuse(true);

    static AnnotationConfigApplicationContext ctx;
    static JdbcTemplate jdbc;
    static MaterialAssetMapper assetMapper;
    static UserInfoMapper userInfoMapper;

    @Configuration
    static class TestConfig {
        @Bean
        DataSource dataSource() {
            HikariConfig cfg = new HikariConfig();
            cfg.setJdbcUrl(mysql.getJdbcUrl());
            cfg.setUsername(mysql.getUsername());
            cfg.setPassword(mysql.getPassword());
            cfg.setMaximumPoolSize(5);
            return new HikariDataSource(cfg);
        }

        @Bean
        SqlSessionFactory sqlSessionFactory(DataSource ds) throws Exception {
            MybatisSqlSessionFactoryBean f = new MybatisSqlSessionFactoryBean();
            f.setDataSource(ds);
            // 默认 MybatisConfiguration（mapUnderscoreToCamelCase=true）——与生产同款
            return f.getObject();
        }

        @Bean
        MaterialAssetMapper materialAssetMapper(SqlSessionFactory sf) throws Exception {
            return factory(MaterialAssetMapper.class, sf).getObject();
        }

        @Bean
        UserInfoMapper userInfoMapper(SqlSessionFactory sf) throws Exception {
            return factory(UserInfoMapper.class, sf).getObject();
        }

        @SuppressWarnings({"unchecked", "rawtypes"})
        private static <T> MapperFactoryBean<T> factory(Class<T> mapperIf, SqlSessionFactory sf)
                throws Exception {
            MapperFactoryBean<T> b = new MapperFactoryBean<>(mapperIf);
            b.setSqlSessionFactory(sf);
            b.afterPropertiesSet();
            return b;
        }
    }

    @BeforeAll
    static void boot() {
        ctx = new AnnotationConfigApplicationContext(TestConfig.class);
        jdbc = new JdbcTemplate(ctx.getBean(DataSource.class));
        assetMapper = ctx.getBean(MaterialAssetMapper.class);
        userInfoMapper = ctx.getBean(UserInfoMapper.class);
    }

    @AfterAll
    static void shutdown() {
        if (ctx != null) ctx.close();
    }

    @BeforeEach
    void cleanup() {
        jdbc.execute("DELETE FROM material_assets");
        jdbc.execute("DELETE FROM user_info");
    }

    /** 直接插一行，可控 gmt_create（跟随窗口的判据就是它）。 */
    private void insert(String materialId, long userId, String status, int ageMinutes) {
        jdbc.update("""
                INSERT INTO material_assets
                  (material_id, user_id, material_group_id, status, gmt_create, gmt_modified)
                VALUES (?, ?, 'group-1', ?, DATE_SUB(NOW(), INTERVAL ? MINUTE), NOW())
                """, materialId, userId, status, ageMinutes);
    }

    private Map<String, Object> read(String materialId) {
        return jdbc.queryForMap(
                "SELECT status, error_code, error_message, status_checked_at, version "
                        + "FROM material_assets WHERE material_id = ?", materialId);
    }

    @Test
    @DisplayName("窗口内只取 Processing 且未超龄的行（Active/Failed/超龄一律不取）")
    void listProcessingWithinAppliesStatusAndWindow() {
        insert("asset-in-window", 9L, "Processing", 1);
        insert("asset-active", 9L, "Active", 1);
        insert("asset-failed", 9L, "Failed", 1);
        insert("asset-too-old", 9L, "Processing", 11);

        List<MaterialAssetEntity> rows = assetMapper.listProcessingWithin(100, 10);

        assertThat(rows).extracting(MaterialAssetEntity::getMaterialId)
                .containsExactly("asset-in-window");
        assertThat(rows.get(0).getUserId()).isEqualTo(9L);
    }

    @Test
    @DisplayName("窗口边界按分钟计：9 分钟前算内、11 分钟前算外")
    void windowBoundaryIsMinutes() {
        insert("asset-9min", 9L, "Processing", 9);
        insert("asset-11min", 9L, "Processing", 11);

        assertThat(assetMapper.listProcessingWithin(100, 10))
                .extracting(MaterialAssetEntity::getMaterialId)
                .containsExactly("asset-9min");
    }

    @Test
    @DisplayName("limit 生效，且按 id 升序（老的先跟进）")
    void listRespectsLimitAndOrder() {
        insert("asset-a", 9L, "Processing", 1);
        insert("asset-b", 9L, "Processing", 1);
        insert("asset-c", 9L, "Processing", 1);

        assertThat(assetMapper.listProcessingWithin(2, 10))
                .extracting(MaterialAssetEntity::getMaterialId)
                .containsExactly("asset-a", "asset-b");
    }

    @Test
    @DisplayName("mirrorStatus 回写状态与失败原文，并推进 status_checked_at / version")
    void mirrorStatusWritesEverything() {
        insert("asset-x", 9L, "Processing", 1);

        int affected = assetMapper.mirrorStatus(9L, "asset-x", "Failed", "InvalidParameter", "人脸不清晰");

        assertThat(affected).isEqualTo(1);
        Map<String, Object> row = read("asset-x");
        assertThat(row.get("status")).isEqualTo("Failed");
        assertThat(row.get("error_code")).isEqualTo("InvalidParameter");
        assertThat(row.get("error_message")).isEqualTo("人脸不清晰");
        assertThat(row.get("status_checked_at")).isNotNull();
        assertThat(((Number) row.get("version")).intValue()).isEqualTo(1);
    }

    @Test
    @DisplayName("mirrorStatus 带 user_id 谓词：别的账号改不动这行（决策 1 的纵深防御）")
    void mirrorStatusIsScopedByUserId() {
        insert("asset-x", 9L, "Processing", 1);

        assertThat(assetMapper.mirrorStatus(77L, "asset-x", "Active", null, null)).isZero();
        assertThat(read("asset-x").get("status")).isEqualTo("Processing");

        assertThat(assetMapper.mirrorStatus(9L, "asset-x", "Active", null, null)).isEqualTo(1);
        assertThat(read("asset-x").get("status")).isEqualTo("Active");
    }

    @Test
    @DisplayName("mirrorStatus 不凭空造行（无行时影响行数为 0）")
    void mirrorStatusNeverInserts() {
        assertThat(assetMapper.mirrorStatus(9L, "asset-nonexistent", "Active", null, null)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM material_assets", Integer.class)).isZero();
    }

    @Test
    @DisplayName("user_info 凭证按 user_id 取；无行返回 null")
    void findCredentialByUserId() {
        jdbc.update("INSERT INTO user_info (user_id, provider_credential) VALUES (?, ?)",
                9L, "sk-user9");

        assertThat(userInfoMapper.findCredential(9L)).isEqualTo("sk-user9");
        assertThat(userInfoMapper.findCredential(77L)).isNull();
    }
}
