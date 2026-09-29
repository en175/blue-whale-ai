package com.bluewhale.billing.adapter.inbound;

import com.bluewhale.billing.adapter.inbound.BillingErrorTaxonomy.Code;
import com.bluewhale.billing.adapter.inbound.BillingErrorTaxonomy.Surface;
import com.bluewhale.billing.adapter.inbound.http.AdminNotFoundException;
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

/**
 * 「异常 → 错误码」这张表的**唯一测试面**。
 *
 * <p>这套判定此前散在三处传输层里，各持一份码表，且**一条测试都没有** ——
 * 「余额不足对外是 402 还是 400」「顺序改错了会变成什么」，此前只能靠读三个文件的注释回答。
 * 现在判定收到 {@link BillingErrorTaxonomy} 一处，这里逐条钉住。
 *
 * <p>断言里刻意同时写**码 + 两个状态**：只钉码的话，把 402 改成 400 这类
 * 「用户看到的处置变了」不会红。
 */
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
        // ⚠️ 前缀格式是契约的一部分：TS 侧按它反解（billing-client.ts 的 toBillingHoldError）
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
        // 第三种 BasePriceResolver.UnpriceableSpecException 是包私有的，
        // 造不出来 —— 那条断言在它自己的包里：domain/pricing/UnpriceableSpecTaxonomyTest

        assertThat(Code.UNPRICEABLE.httpStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    void 目录文档编不过_按面分叉() {
        // 唯一按面分叉的一处：管理面提交的**就是**这份文档（告诉他去改文档）；
        // 用户面拿到的是「这条能力行的规则坏了」，他改不了，只能换模型。
        // 混成一个码，运维看到时无法判断该查目录还是查自己刚提交的文档。
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
                // 表名与索引名对调用方没有意义，不该出现在对外文案里
                .doesNotContain("uk_idempotency_key")
                .doesNotContain("billing_credit_lot");
    }

    @Test
    void 参数错误_两面都带码前缀() {
        // ⚠️ 用户面此前**不带**前缀（`Status.INVALID_ARGUMENT.withDescription(e.getMessage())`），
        // 与另外两面不一致 —— 契约里「每个失败都带码」这句话在那一支上不成立。本 PR 统一。
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
        // 对外只给一句通用话：库表名、SQL 片段、金额一律不外泄
        assertThat(failure.description())
                .isEqualTo(BillingErrorTaxonomy.INTERNAL_MESSAGE)
                .doesNotContain("billing_ledger")
                .doesNotContain("SQL");
        // 原文仍留在 Failure 里，供调用方记日志
        assertThat(failure.logDetail()).contains("billing_ledger");
    }

    @Test
    void 五个具体异常都不是_IllegalArgumentException_的子类() {
        // 这条不是形式主义：三处映射的注释都写着「顺序必须从具体到宽泛，否则余额不足会被
        // 翻译成参数错误」。而真实后果是**掉到兜底的 INTERNAL**（对外「billing 挂了」），
        // 因为这几类都不是 IAE。哪天有人真把它们改成 IAE 的子类，顺序就真的开始起作用了 ——
        // 那时这条会红，提醒回来重新看分类器的顺序。
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
        // ⚠️ 前缀是 TS 反解的**锚**：billing-client.ts 对 status description 做 includes，
        //    少一个前缀就多一条静默退化成 502 的路。逐码断言而不是只挑两个 ——
        //    只挑两个的话，将来新加的码会带着「没前缀」溜进去。
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
        // 表驱动而不是只挑两条：`UNPRICEABLE.grpcCode()` 必须是 INVALID_ARGUMENT ——
        // billing-client.ts 正是按 (码, 原因词) **一起**判的，这一半漂了没人会红
        // （此前只有 DB 门控的集成测试间接覆盖，不设 BILLING_DB_PASSWORD 就全 skip）。
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
