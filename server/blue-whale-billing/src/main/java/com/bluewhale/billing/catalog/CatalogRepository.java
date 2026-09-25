package com.bluewhale.billing.catalog;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.bluewhale.billing.domain.DbTime;
import com.bluewhale.billing.domain.entity.PricingCatalogEntity;
import com.bluewhale.billing.infrastructure.mapper.PricingCatalogMapper;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.Map;

/**
 * 定价目录的持久化访问 —— **纯 DB 读写，不持有状态**。
 *
 * <p>把「读库」与「持有一份编译结果」分开，是为了让后者（{@link CatalogHolder}）
 * 可以被纯函数地测试，也为了让「生效中版本」与「历史版本」走同一条读取路径。
 *
 * <p>SQL 在 {@link PricingCatalogMapper} 与 {@code resources/mapper/PricingCatalogMapper.xml}。
 * 改造前这里把 {@code "WHERE status = 'active' ORDER BY ... LIMIT 1"} 拆成片段在 Java 里拼接，
 * 改索引或加条件时容易只改一边——现在整条语句在 XML 里一眼看完。
 */
@Repository
public class CatalogRepository {

    private final PricingCatalogMapper mapper;
    private final ObjectMapper json;

    public CatalogRepository(PricingCatalogMapper mapper) {
        this.mapper = mapper;
        // ⚠️ 容忍未知字段：向前兼容——运营端先加字段、服务端后升级时不该直接崩。
        //    方向不能反（不能容忍「服务端认识但 JSON 里没有」的必填字段，
        //    那由 CatalogCompiler 的构造校验兜住）。
        this.json = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    }

    /**
     * 读取当前生效版本。
     *
     * @return 未发布任何目录时返回 null（调用方据此拒绝计价，而不是算成 0）
     */
    public LoadedCatalog loadActive() {
        return compile(mapper.selectActive());
    }

    /**
     * 按版本号读取 —— 结算时按 job 冻结的版本复现定价用。
     *
     * <p>retired 版本**必须仍可读**：改价不影响已提交任务，靠的就是这里能取回老版本。
     */
    public LoadedCatalog loadVersion(int catalogVersion) {
        return compile(mapper.selectOne(new LambdaQueryWrapper<PricingCatalogEntity>()
                .eq(PricingCatalogEntity::getCatalogVersion, catalogVersion)));
    }

    private LoadedCatalog compile(PricingCatalogEntity row) {
        if (row == null) {
            return null;
        }
        CatalogDocument document;
        try {
            document = json.readValue(row.getDocument(), CatalogDocument.class);
        } catch (Exception e) {
            // JSON 本身读不出来 = 存储层坏了，与「配置写错」不同，但处理方式一样：拒绝
            throw new CatalogCompiler.CompileException(
                    "目录 v" + row.getCatalogVersion() + " 的 document 不是合法 JSON："
                            + e.getMessage(), e);
        }
        // ⚠️ 编译失败会抛异常 —— 调用方（CatalogHolder）必须**保持旧版本**，不能降级为 0
        return new LoadedCatalog(
                row.getCatalogVersion(),
                row.getDocumentHash(),
                document,
                CatalogCompiler.compile(document),
                DbTime.fromDb(row.getPublishedAt()));
    }

    /**
     * 一次加载的完整结果。
     *
     * @param index 编译后的索引：{@code modelId/taskType → CompiledRule}
     */
    public record LoadedCatalog(
            int version,
            String documentHash,
            CatalogDocument document,
            Map<String, com.bluewhale.billing.pricing.CompiledRule> index,
            Instant publishedAt
    ) {

        /**
         * 本版本声明的换算率：**1 元 = 多少积分**。
         *
         * <p>语义化入口，免得调用方为了取一个数去穿三层（{@code loaded.document().creditsPerYuan()}）。
         * 结算要按 job 冻结的版本复现时，就该从对应版本的 {@code LoadedCatalog} 上读它。
         */
        public int creditsPerYuan() {
            return document.creditsPerYuan();
        }
    }
}
