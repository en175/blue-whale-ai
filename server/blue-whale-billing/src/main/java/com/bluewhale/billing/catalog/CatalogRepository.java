package com.bluewhale.billing.catalog;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;

/**
 * 定价目录的持久化访问 —— **纯 DB 读写，不持有状态**。
 *
 * <p>把「读库」与「持有一份编译结果」分开，是为了让后者（{@link CatalogHolder}）
 * 可以被纯函数地测试，也为了让「生效中版本」与「历史版本」走同一条读取路径。
 */
@Repository
public class CatalogRepository {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public CatalogRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
        // ⚠️ 容忍未知字段：向前兼容——运营端先加字段、服务端后升级时不该直接崩。
        //    方向不能反（不能容忍「服务端认识但 JSON 里没有」的必填字段，
        //    那由 CatalogCompiler 的构造校验兜住）。
        this.mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    }

    /**
     * 读取当前生效版本。
     *
     * @return 未发布任何目录时返回 null（调用方据此拒绝计价，而不是算成 0）
     */
    public LoadedCatalog loadActive() {
        return queryOne("WHERE status = 'active' ORDER BY catalog_version DESC LIMIT 1");
    }

    /**
     * 按版本号读取 —— 结算时按 job 冻结的版本复现定价用。
     *
     * <p>retired 版本**必须仍可读**：改价不影响已提交任务，靠的就是这里能取回老版本。
     */
    public LoadedCatalog loadVersion(int catalogVersion) {
        return queryOne("WHERE catalog_version = ?", catalogVersion);
    }

    private LoadedCatalog queryOne(String whereClause, Object... args) {
        var rows = jdbc.query(
                "SELECT catalog_version, document, document_hash, schema_version, published_at "
                        + "FROM billing_pricing_catalogs " + whereClause,
                (rs, rowNum) -> new Row(
                        rs.getInt("catalog_version"),
                        rs.getString("document"),
                        rs.getString("document_hash"),
                        rs.getInt("schema_version"),
                        rs.getTimestamp("published_at")),
                args);
        return rows.isEmpty() ? null : compile(rows.get(0));
    }

    private LoadedCatalog compile(Row row) {
        CatalogDocument document;
        try {
            document = mapper.readValue(row.document(), CatalogDocument.class);
        } catch (Exception e) {
            // JSON 本身读不出来 = 存储层坏了，与「配置写错」不同，但处理方式一样：拒绝
            throw new CatalogCompiler.CompileException(
                    "目录 v" + row.version() + " 的 document 不是合法 JSON：" + e.getMessage(), e);
        }
        // ⚠️ 编译失败会抛异常 —— 调用方（CatalogHolder）必须**保持旧版本**，不能降级为 0
        return new LoadedCatalog(
                row.version(),
                row.hash(),
                document,
                CatalogCompiler.compile(document),
                row.publishedAt() == null ? null : row.publishedAt().toInstant());
    }

    private record Row(int version, String document, String hash, int schemaVersion, Timestamp publishedAt) {}

    /**
     * 一次加载的完整结果。
     *
     * @param index 编译后的索引：{@code modelId/taskType → CompiledRule}
     */
    public record LoadedCatalog(
            int version,
            String documentHash,
            CatalogDocument document,
            java.util.Map<String, com.bluewhale.billing.pricing.CompiledRule> index,
            Instant publishedAt
    ) {}
}
