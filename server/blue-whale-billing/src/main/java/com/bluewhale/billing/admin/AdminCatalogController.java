package com.bluewhale.billing.admin;

import com.bluewhale.billing.catalog.CatalogHolder;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 定价目录的管理端接口（《架构设计》§12）。
 *
 * <p>发布一个版本 = 一次请求，**立即生效**，不需要重启、不需要改配置。
 *
 * <p>⚠️ <b>本接口没有鉴权</b>，因为它属于内网控制面（billing 的 HTTP 端口不对公网开放）。
 * 管理端鉴权落地前，禁止把它暴露出去。
 */
@RestController
@RequestMapping("/admin/catalogs")
@ConditionalOnProperty(name = "billing.admin.enabled", havingValue = "true")
public class AdminCatalogController {

    private final CatalogPublisher publisher;
    private final CatalogHolder holder;

    public AdminCatalogController(CatalogPublisher publisher, CatalogHolder holder) {
        this.publisher = publisher;
        this.holder = holder;
    }

    /**
     * 发布一份目录文档。
     *
     * <p><b>请求体就是目录 JSON 原文</b>（不是包一层的 {"document": "..."}）：
     * 包一层的话运营得把整份文档转义成字符串，容易出错；而我们要的正是**原文逐字节**——
     * 存它、对它取 hash，出问题时可与运营提交的内容原样比对。
     *
     * <pre>
     * curl -X POST 'localhost:4003/admin/catalogs?publishedBy=ops&amp;note=首版' \
     *      -H 'Content-Type: application/json' --data-binary @catalog.json
     * </pre>
     *
     * <p>⚠️ 目录里**不含任何计价规则**（规则住在模型能力行），只有换算率与折扣策略。
     * 老目录行里那个 {@code models} 段会被忽略，不需要清理。
     *
     * @return 本次生效的版本号，以及本版生效的换算率 {@code creditsPerYuan}（1 元 = 多少积分）——
     *         发布是改口径的唯一入口，回包里带上它，运营不必再查一次库才知道发对了没有
     */
    @PostMapping
    public Map<String, Object> publish(@RequestBody String documentJson,
                                       @RequestParam(defaultValue = "admin") String publishedBy,
                                       @RequestParam(defaultValue = "") String note) {
        int version = publisher.publish(documentJson, publishedBy, note);
        return Map.of(
                "catalogVersion", version,
                "documentHash", holder.currentDocumentHash(),
                "creditsPerYuan", holder.currentCreditsPerYuan());
    }
}
