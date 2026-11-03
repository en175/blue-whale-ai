package com.bluewhale.billing.api;

import com.bluewhale.billing.api.dto.GrantRequest;
import com.bluewhale.billing.api.dto.GrantResponse;
import com.bluewhale.billing.api.dto.RefundRequest;
import com.bluewhale.billing.application.BillingApplicationService;
import com.bluewhale.billing.application.CreditService;
import com.bluewhale.billing.application.view.BalanceView;
import com.bluewhale.billing.common.error.DuplicateGrantKeyException;
import com.bluewhale.billing.domain.ledger.CreditSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/admin/credits")
@ConditionalOnProperty(name = "billing.admin.enabled", havingValue = "true")
public class AdminCreditController {

    private static final Logger log = LoggerFactory.getLogger(AdminCreditController.class);

    private final BillingApplicationService billing;
    private final CreditService credits;

    public AdminCreditController(BillingApplicationService billing, CreditService credits) {
        this.billing = billing;
        this.credits = credits;
        log.warn("管理端接口已启用（{}）——**无鉴权**，仅限内网。管理端鉴权落地前禁止对外暴露。",
                AdminCreditController.class.getSimpleName());
    }

    @PostMapping("/grants")
    public GrantResponse grant(@RequestBody GrantRequest request) {
        CreditSource source = CreditSource.of(request.source());
        String grantKey = request.grantKey() == null
                ? source.key() + ":" + request.bizId()
                : request.grantKey();
        long lotId;
        try {
            lotId = billing.grant(
                    request.userId(),
                    source,
                    request.amount(),
                    request.bizType() == null ? "grant" : request.bizType(),
                    request.bizId(),
                    grantKey,
                    request.expiresAtLocal());
        } catch (DuplicateKeyException e) {
            throw new DuplicateGrantKeyException(billing.findGrantOwner(grantKey));
        }

        return new GrantResponse(lotId, request.userId(), source.key(), request.amount());
    }

    @GetMapping("/balances/{userId}")
    public BalanceView balance(@PathVariable long userId) {
        return billing.balance(userId);
    }

    @PostMapping("/jobs/{jobId}/refund")
    public Map<String, Object> refund(@PathVariable long jobId, @RequestBody RefundRequest request) {
        credits.refund(jobId, request.reason() == null ? "人工释放" : request.reason());
        return Map.of("jobId", jobId, "status", "refunded");
    }
}
