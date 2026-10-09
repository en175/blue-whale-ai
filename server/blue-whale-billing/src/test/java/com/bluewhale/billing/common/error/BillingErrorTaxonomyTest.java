package com.bluewhale.billing.common.error;

import com.bluewhale.billing.common.error.BillingErrorTaxonomy.Code;
import com.bluewhale.billing.common.error.BillingErrorTaxonomy.Surface;
import com.bluewhale.billing.api.AdminNotFoundException;
import com.bluewhale.billing.application.CatalogCompiler;
import com.bluewhale.billing.domain.ledger.InsufficientCreditsException;
import com.bluewhale.billing.domain.pricing.PricingEngine;
import com.bluewhale.billing.domain.pricing.Usage;
import com.bluewhale.billing.domain.pricing.UsageDim;
import io.grpc.Status;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class BillingErrorTaxonomyTest {

    private static BillingErrorTaxonomy.Failure user(RuntimeException e) {
        return BillingErrorTaxonomy.classify(e, Surface.USER);
    }

    private static BillingErrorTaxonomy.Failure admin(RuntimeException e) {
        return BillingErrorTaxonomy.classify(e, Surface.ADMIN);
    }

    @Test
    void 余额不足_402_且原文就是异常那句话() {
        var failure = user(new InsufficientCreditsException(10, 100));

        assertThat(failure.code()).isEqualTo(Code.INSUFFICIENT_CREDITS);
        assertThat(failure.code().httpStatus()).isEqualTo(HttpStatus.PAYMENT_REQUIRED);
        assertThat(failure.code().grpcCode()).isEqualTo(Status.Code.FAILED_PRECONDITION);
        assertThat(failure.description())
                .isEqualTo("INSUFFICIENT_CREDITS: 积分不足：可用 10，需要 100，还差 90");
    }

    @Test
    void 算不出价_三种异常同一处置() {
        assertThat(user(new PricingEngine.RuleNotFoundException("m1", "t2i")).code())
                .isEqualTo(Code.UNPRICEABLE);
        assertThat(user(new Usage.ContractQuantityUnavailableException(
                UsageDim.SECONDS, Map.of("duration", "5"))).code())
                .isEqualTo(Code.UNPRICEABLE);

        assertThat(Code.UNPRICEABLE.httpStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    void 目录文档编不过_按面分叉() {
        var e = new CatalogCompiler.CompileException("字段 basePrice 不成立");

        assertThat(admin(e).code()).isEqualTo(Code.INVALID_ARGUMENT);
        assertThat(user(e).code()).isEqualTo(Code.UNPRICEABLE);
    }

    @Test
    void 目标不存在_404_不被参数错误吃掉() {
        var failure = admin(new AdminNotFoundException("折扣 7 已经不在了，刷新一下"));

        assertThat(failure.code()).isEqualTo(Code.NOT_FOUND);
        assertThat(failure.code().httpStatus()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(failure.code().grpcCode()).isEqualTo(Status.Code.NOT_FOUND);
    }

    @Test
    void 幂等键撞车_409_且不回传_JDBC_原文() {
        var failure = admin(new DuplicateKeyException(
                "Duplicate entry 'k-1' for key 'billing_credit_lot.uk_idempotency_key'"));

        assertThat(failure.code()).isEqualTo(Code.DUPLICATE);
        assertThat(failure.code().httpStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(failure.description())
                .isEqualTo("DUPLICATE: " + BillingErrorTaxonomy.DUPLICATE_MESSAGE)
                .doesNotContain("uk_idempotency_key")
                .doesNotContain("billing_credit_lot");
    }

    @Test
    void 参数错误_两面都带码前缀() {
        var e = new IllegalArgumentException("档位 7 的折扣不合法");

        assertThat(admin(e).description()).isEqualTo("INVALID_ARGUMENT: 档位 7 的折扣不合法");
        assertThat(user(e).description()).isEqualTo("INVALID_ARGUMENT: 档位 7 的折扣不合法");
    }

    @Test
    void 内部错误_500_原文只进日志() {
        var failure = user(new IllegalStateException("表 billing_ledger 主键冲突：SQL 片段…"));

        assertThat(failure.code()).isEqualTo(Code.INTERNAL);
        assertThat(failure.code().httpStatus()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        assertThat(failure.internal()).isTrue();
        assertThat(failure.description())
                .isEqualTo(BillingErrorTaxonomy.INTERNAL_MESSAGE)
                .doesNotContain("billing_ledger")
                .doesNotContain("SQL");
        assertThat(failure.logDetail()).contains("billing_ledger");
    }

    @Test
    void 五个具体异常都不是_IllegalArgumentException_的子类() {
        assertThat(new InsufficientCreditsException(1, 2))
                .isNotInstanceOf(IllegalArgumentException.class);
        assertThat(new AdminNotFoundException("x"))
                .isNotInstanceOf(IllegalArgumentException.class);
        assertThat(new PricingEngine.RuleNotFoundException("m", "t"))
                .isNotInstanceOf(IllegalArgumentException.class);
        assertThat(new CatalogCompiler.CompileException("x"))
                .isNotInstanceOf(IllegalArgumentException.class);
        assertThat(new DuplicateKeyException("x"))
                .isNotInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void 每个非内部错误的描述都带码前缀() {
        for (Code code : Code.values()) {
            String description = new BillingErrorTaxonomy.Failure(code, "原文").description();

            if (code == Code.INTERNAL) {
                assertThat(description)
                        .as("内部错误不带码前缀（此前三处都如此）")
                        .isEqualTo(BillingErrorTaxonomy.INTERNAL_MESSAGE);
            } else {
                assertThat(description)
                        .as("%s 的 description 必须带码前缀", code)
                        .startsWith(code.wire() + ": ");
            }
        }
    }

    @Test
    void 六个码的两个状态逐条钉住() {
        assertThat(Code.INSUFFICIENT_CREDITS.grpcCode()).isEqualTo(Status.Code.FAILED_PRECONDITION);
        assertThat(Code.INSUFFICIENT_CREDITS.httpStatus()).isEqualTo(HttpStatus.PAYMENT_REQUIRED);
        assertThat(Code.UNPRICEABLE.grpcCode()).isEqualTo(Status.Code.INVALID_ARGUMENT);
        assertThat(Code.UNPRICEABLE.httpStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(Code.DUPLICATE.grpcCode()).isEqualTo(Status.Code.ALREADY_EXISTS);
        assertThat(Code.DUPLICATE.httpStatus()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(Code.NOT_FOUND.grpcCode()).isEqualTo(Status.Code.NOT_FOUND);
        assertThat(Code.NOT_FOUND.httpStatus()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(Code.INVALID_ARGUMENT.grpcCode()).isEqualTo(Status.Code.INVALID_ARGUMENT);
        assertThat(Code.INVALID_ARGUMENT.httpStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(Code.INTERNAL.grpcCode()).isEqualTo(Status.Code.INTERNAL);
        assertThat(Code.INTERNAL.httpStatus()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
    }
}
