package com.bluewhale.billing.admin;

import com.bluewhale.billing.application.BalanceView;
import com.bluewhale.billing.application.BillingApplicationService;
import com.bluewhale.billing.ledger.CreditSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;

/**
 * 积分的管理端接口（《架构设计》§12）。
 *
 * <p>发放走这里，**不是**让运营直接写库：写库要同时插批次与两条账本分录、
 * 还要算 {@code balance_after}，任何一步漏掉账就不平，而且没有幂等保护——
 * 手抖执行两次就是双倍发放。
 *
 * <p>⚠️ <b>本接口没有鉴权。</b>它与 {@code Hold} 的差别在于：Hold 受用户余额约束，
 * 而这个接口能**凭空生积分**。billing 的 HTTP 端口只在内网，
 * 管理端鉴权落地前禁止对外暴露。
 */
@RestController
@RequestMapping("/admin/credits")
@ConditionalOnProperty(name = "billing.admin.enabled", havingValue = "true")
public class AdminCreditController {

    private static final Logger log = LoggerFactory.getLogger(AdminCreditController.class);

    private final BillingApplicationService billing;

    public AdminCreditController(BillingApplicationService billing) {
        this.billing = billing;
        log.warn("管理端接口已启用（{}）——**无鉴权**，仅限内网。管理端鉴权落地前禁止对外暴露。",
                AdminCreditController.class.getSimpleName());
    }

    /**
     * 发放积分。
     *
     * <p>有效期不用传：由 {@link com.bluewhale.billing.application.GrantPolicy}
     * 按来源决定（充值本金永久、赠送类 30 天、每日赠送当日 23:59 过期…）。
     * 确实需要一次性特殊有效期时才传 {@code expiresAt}。
     *
     * <pre>
     * curl -X POST localhost:4003/admin/credits/grants -H 'Content-Type: application/json' \
     *      -d '{"userId":9001,"source":"purchased","amount":1000,"bizId":"local-1"}'
     * </pre>
     *
     * @param request {@code grantKey} 省略时按 {@code source:bizId} 生成 ——
     *                同一个 {@code bizId} 重复发放会被唯一索引拦下（409），
     *                这是防止手抖发两次的保护；要再发一笔就换一个 bizId
     */
    @PostMapping("/grants")
    public GrantResponse grant(@RequestBody GrantRequest request) {
        CreditSource source = CreditSource.of(request.source());
        long lotId = billing.grant(
                request.userId(),
                source,
                request.amount(),
                request.bizType() == null ? "grant" : request.bizType(),
                request.bizId(),
                request.grantKey() == null ? source.key() + ":" + request.bizId() : request.grantKey(),
                request.expiresAt());

        return new GrantResponse(lotId, request.userId(), source.key(), request.amount());
    }

    /** 余额与临期批次（与 gRPC 的 QueryBalance 同一份数据）。 */
    @GetMapping("/balances/{userId}")
    public BalanceView balance(@PathVariable long userId) {
        return billing.balance(userId);
    }

    /**
     * @param expiresAt 显式覆盖有效期；省略则按来源的默认策略
     */
    public record GrantRequest(
            long userId,
            String source,
            long amount,
            String bizId,
            String bizType,
            String grantKey,
            Instant expiresAt
    ) {
        public GrantRequest {
            if (bizId == null || bizId.isBlank()) {
                // bizId 是这批积分的来路凭证，没有它事后无法回答「这 1000 分为何在这里」
                throw new IllegalArgumentException("bizId 必填——它是这批积分的来路凭证");
            }
        }
    }

    public record GrantResponse(long lotId, long userId, String source, long amount) {}
}
