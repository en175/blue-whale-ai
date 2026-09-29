package com.bluewhale.billing.adapter.inbound.http;

import com.bluewhale.billing.adapter.inbound.BillingErrorTaxonomy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 管理端接口的异常 → HTTP 状态映射。
 *
 * <p>错误码与「异常 → 码」的判定都在 {@link BillingErrorTaxonomy}：三处传输层
 * （用户面 gRPC、管理面 gRPC、这里）共用一处定义。同一个原因在两个传输层给两套码，
 * 会让「按码写告警规则」这件事变得没法做；而三处各持一份码表，则会让「改一处、
 * 漏两处」变成常态。
 *
 * <p>本类只剩 HTTP **特有**的那两件事：
 *
 * <ul>
 *   <li>请求体解析失败：Jackson 把 record 紧凑构造器抛出的
 *       {@link IllegalArgumentException} **包成** {@link HttpMessageNotReadableException}，
 *       不拆开取根因的话，校验写得再严，用户看到的都是 500；</li>
 *   <li>幂等键撞车**且已知归属**（发放路径会先查一下键归谁再抛）：409 本身分不出
 *       「我自己发过」与「别人先占了」——这两件事在业务上是相反的结论，所以多回一个
 *       {@code existingBizId}。</li>
 * </ul>
 *
 * <p>⚠️ 内部错误（500）**不外泄细节**——异常消息可能带库表名、SQL 片段或金额，
 * 只进日志。调用方拿到统一的一句话。
 */
@RestControllerAdvice(basePackages = "com.bluewhale.billing.adapter.inbound.http")
public class AdminExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(AdminExceptionHandler.class);

    /**
     * 其余全部走分类器。
     *
     * <p>⚠️ 用一个 handler 接住所有运行时异常，是因为**判定顺序已经收进分类器**：
     * 此前这里有九个方法，靠 Spring「按类继承距离选最具体的那个」分流 ——
     * 每加一个异常都得想清楚「它会不会被上面那条更宽的接走」，而那条依赖是隐性的，
     * 也没有任何测试守着。现在顺序写在 {@link BillingErrorTaxonomy#classify} 一处，
     * 且可以被单测直接钉住。
     */
    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<ErrorBody> handle(RuntimeException e) {
        BillingErrorTaxonomy.Failure failure =
                BillingErrorTaxonomy.classify(e, BillingErrorTaxonomy.Surface.ADMIN);
        if (failure.internal()) {
            log.error("管理端接口内部错误", e);
        }
        return ResponseEntity.status(failure.code().httpStatus())
                .body(new ErrorBody(failure.code().wire(), failure.outwardDetail()));
    }

    /**
     * 请求体解析失败。
     *
     * <p>⚠️ 必须单独接住：Jackson 把 record 紧凑构造器抛出的
     * {@link IllegalArgumentException} 包成了 {@link HttpMessageNotReadableException}，
     * 于是分类器里那条 {@code IllegalArgumentException} 分支根本轮不到 ——
     * 校验写得再严，用户看到的都是 500。
     */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorBody> unreadable(HttpMessageNotReadableException e) {
        Throwable cause = e.getMostSpecificCause();
        String message = cause instanceof IllegalArgumentException
                ? cause.getMessage()
                : "请求体不是合法的 JSON 或字段类型不匹配";
        return ResponseEntity.status(BillingErrorTaxonomy.Code.INVALID_ARGUMENT.httpStatus())
                .body(new ErrorBody(BillingErrorTaxonomy.Code.INVALID_ARGUMENT.wire(), message));
    }

    /**
     * 幂等键撞车**且已知归属**（见类注释）。
     *
     * <p>与走分类器的那条同码同文案，只多一个 {@code existingBizId} ——
     * 调用方靠它区分两件事，而不是靠两个码（两个码会让「幂等撞车」的告警规则要写两条）。
     */
    @ExceptionHandler(DuplicateGrantKeyException.class)
    public ResponseEntity<ErrorBody> duplicateGrant(DuplicateGrantKeyException e) {
        return ResponseEntity.status(BillingErrorTaxonomy.Code.DUPLICATE.httpStatus())
                .body(new ErrorBody(BillingErrorTaxonomy.Code.DUPLICATE.wire(),
                        e.getMessage(), e.existingBizId()));
    }

    /** 错误响应体。{@code code} 稳定可判、{@code message} 只用于人读。 */
    public record ErrorBody(String code, String message, String existingBizId) {
        /** 多数错误没有「归属」可言，给个两参构造器，免得多处调用点都得写个 null。 */
        public ErrorBody(String code, String message) {
            this(code, message, null);
        }
    }
}
