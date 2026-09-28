package com.bluewhale.billing.adapter.outbound.persistence.repository;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.bluewhale.billing.application.CatalogCompiler;
import com.bluewhale.billing.domain.DbTime;
import com.bluewhale.billing.adapter.outbound.persistence.entity.PricingCatalogEntity;
import com.bluewhale.billing.adapter.outbound.persistence.mapper.PricingCatalogMapper;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.bluewhale.billing.domain.catalog.CatalogDocument;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Repository;

import java.time.Instant;

/**
 * 定价目录的持久化访问 —— **纯 DB 读写，不持有状态**。
 *
 * <p>把「读库」与「持有一份解析结果」分开，是为了让后者（{@link com.bluewhale.billing.application.CatalogHolder}）
 * 可以被纯函数地测试，也为了让「生效中版本」与「历史版本」走同一条读取路径。
 *
 * <p>SQL 在 {@link PricingCatalogMapper} 与 {@code resources/mapper/PricingCatalogMapper.xml}。
 * 改造前这里把 {@code "WHERE status = 'active' ORDER BY ... LIMIT 1"} 拆成片段在 Java 里拼接，
 * 改索引或加条件时容易只改一边——现在整条语句在 XML 里一眼看完。
 *
 * <p>⚠️ <b>老的目录行里还留着 {@code models} 段，但那不需要数据迁移</b>：
 * 计价规则已搬进模型能力行，{@link CatalogDocument} 里没有这个字段了，
 * 而下面那个 {@code ObjectMapper} 配了 {@code FAIL_ON_UNKNOWN_PROPERTIES=false}——
 * 库里的 {@code models} 会被**当作未知字段直接忽略**，读取照常。
 * （刻意不去改历史迁移脚本或清库：Flyway 迁移改一个字节就会校验失败，
 * 而清理老行没有任何收益——它只影响 {@code document} 那一列的文本。）
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
        //    ⚠️ 老目录行里的 models 段（规则搬进能力行之前留下的）也走这一条被忽略掉。
        this.json = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    }

    /**
     * 读取当前生效版本。
     *
     * @return 未发布任何目录时返回 null（调用方据此拒绝计价，而不是算成 0）
     */
    public LoadedCatalog loadActive() {
        return load(mapper.selectActive());
    }

    private LoadedCatalog load(PricingCatalogEntity row) {
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
        // ⚠️ 校验失败会抛异常 —— 调用方（CatalogHolder）必须**保持旧版本**，不能降级为 0
        CatalogCompiler.validate(document);
        return new LoadedCatalog(
                row.getCatalogVersion(),
                row.getDocumentHash(),
                row.getDocument(),
                document,
                DbTime.fromDb(row.getPublishedAt()));
    }

    /**
     * 一次加载的完整结果。
     *
     * @param documentJson **落库的目录文本**，与 {@code document}（解析后的形态）并存。
     *                     两者不是冗余：管理端要「读回来改一改再整份发布」，而发布接口收的是
     *                     文本（见 {@code CatalogPublisher}）。若只留解析后的 {@link CatalogDocument}，
     *                     读回来再序列化会**丢掉服务端不认识的字段**（那些字段正是靠
     *                     {@code FAIL_ON_UNKNOWN_PROPERTIES=false} 容忍下来、留给未来版本的），
     *                     一次「只改一个单价」的无害操作就会把它们静默删掉。
     *                     <p>⚠️ 但**它不等于发布时提交的那串字节**：{@code document} 列是 MySQL 的
     *                     JSON 类型，读回来是它自己的规范化文本（键按长度重排、冒号后补空格）。
     *                     所以 {@code documentHash}（发布时对**提交文本**取的 SHA-256）与
     *                     {@code sha256(documentJson)} 不相等。判定「内容有没有变」必须比
     *                     解析后的对象，比文本会把一次没改过的保存变成一个新版本。
     */
    public record LoadedCatalog(
            int version,
            String documentHash,
            String documentJson,
            CatalogDocument document,
            Instant publishedAt
    ) {

        /**
         * 本版本声明的换算率：**1 元 = 多少积分**。
         *
         * <p>语义化入口，免得调用方为了取一个数去穿三层（{@code loaded.document().creditsPerYuan()}）。
         * 充值按订单冻结的版本复现时就该从对应版本的 {@code LoadedCatalog} 上读它。
         */
        public int creditsPerYuan() {
            return document.creditsPerYuan();
        }
    }
}
