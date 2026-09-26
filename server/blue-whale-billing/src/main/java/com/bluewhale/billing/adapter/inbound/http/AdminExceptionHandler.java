package com.bluewhale.billing.adapter.inbound.http;

import com.bluewhale.billing.application.CatalogCompiler;
import com.bluewhale.billing.domain.ledger.InsufficientCreditsException;
import com.bluewhale.billing.domain.pricing.BasePriceResolver;
import com.bluewhale.billing.domain.pricing.PricingEngine;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 管理端接口的异常 → HTTP 状态映射。
 *
 * <p>错误码与 gRPC 侧**同名同义**（{@code INSUFFICIENT_CREDITS} / {@code UNPRICEABLE}）：
 * 同一个原因在两个传输层给两套码，会让「按码写告警规则」这件事变得没法做。
 *
 * <p>⚠️ 内部错误（500）**不外泄细节**——异常消息可能带库表名、SQL 片段或金额，
 * 只进日志。调用方拿到统一的一句话。
 */
@RestControllerAdvice(basePackages = "com.bluewhale.billing.adapter.inbound.http")
public class AdminExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(AdminExceptionHandler.class);

    private static final String CODE_INSUFFICIENT_CREDITS = "INSUFFICIENT_CREDITS";
    private static final String CODE_UNPRICEABLE = "UNPRICEABLE";
    private static final String CODE_DUPLICATE = "DUPLICATE";
    private static final String CODE_INVALID = "INVALID_ARGUMENT";
    private static final String CODE_NOT_FOUND = "NOT_FOUND";
    private static final String CODE_INTERNAL = "INTERNAL";

    @ExceptionHandler(InsufficientCreditsException.class)
    public ResponseEntity<ErrorBody> insufficient(InsufficientCreditsException e) {
        return ResponseEntity.status(HttpStatus.PAYMENT_REQUIRED)
                .body(new ErrorBody(CODE_INSUFFICIENT_CREDITS, e.getMessage()));
    }

    @ExceptionHandler({PricingEngine.RuleNotFoundException.class,
            BasePriceResolver.UnpriceableSpecException.class})
    public ResponseEntity<ErrorBody> unpriceable(RuntimeException e) {
        // 这两个是**运行期**算不出价：请求本身合法，是规则里没覆盖到这个组合。
        // 对调用方而言这次提交不该继续（fail closed），对运维是一条「去补配置」的信号。
        return ResponseEntity.badRequest().body(new ErrorBody(CODE_UNPRICEABLE, e.getMessage()));
    }

    /**
     * 提交的目录文档编译不过。
     *
     * <p>刻意与 {@link #unpriceable} 分开：那个是「运行时按现有目录算不出价」，
     * 这个是「你现在要发布的这份文档本身不成立」。混成一个码，
     * 运维看到 UNPRICEABLE 时无法判断该去查目录还是查自己刚提交的文档。
     */
    @ExceptionHandler(CatalogCompiler.CompileException.class)
    public ResponseEntity<ErrorBody> invalidCatalog(CatalogCompiler.CompileException e) {
        return ResponseEntity.badRequest().body(new ErrorBody(CODE_INVALID, e.getMessage()));
    }

    /**
     * 请求体解析失败。
     *
     * <p>⚠️ 必须单独接住：Jackson 把 record 紧凑构造器抛出的
     * {@link IllegalArgumentException} **包成** {@code HttpMessageNotReadableException}，
     * 于是下面那个 {@code IllegalArgumentException} 的处理器根本轮不到——
     * 校验写得再严，用户看到的都是 500。
     */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorBody> unreadable(HttpMessageNotReadableException e) {
        Throwable cause = e.getMostSpecificCause();
        String message = cause instanceof IllegalArgumentException
                ? cause.getMessage()
                : "请求体不是合法的 JSON 或字段类型不匹配";
        return ResponseEntity.badRequest().body(new ErrorBody(CODE_INVALID, message));
    }

    @ExceptionHandler(DuplicateKeyException.class)
    public ResponseEntity<ErrorBody> duplicate(DuplicateKeyException e) {
        // 幂等键撞车 = 这次操作之前已经成功过。不是失败，是**已经做过了**。
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(new ErrorBody(CODE_DUPLICATE,
                        "该幂等键已存在：这次操作之前已经成功过，未重复执行"));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ErrorBody> invalid(IllegalArgumentException e) {
        return ResponseEntity.badRequest().body(new ErrorBody(CODE_INVALID, e.getMessage()));
    }

    /**
     * 目标不存在（改/删一条已被删掉的折扣）。
     *
     * <p>⚠️ 必须**排在 {@link #invalid} 之前**判定：404 与 400 在界面上是两句不同的人话 ——
     * 「你填的不对，回去改表单」与「这条已经不在了，刷新一下」。
     * 合成 400 会让运营对着一个没有问题的表单反复保存。
     */
    @ExceptionHandler(AdminNotFoundException.class)
    public ResponseEntity<ErrorBody> notFound(AdminNotFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(new ErrorBody(CODE_NOT_FOUND, e.getMessage()));
    }

    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<ErrorBody> internal(RuntimeException e) {
        log.error("管理端接口内部错误", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(new ErrorBody(CODE_INTERNAL, "billing 内部错误"));
    }

    /** 错误响应体。{@code code} 稳定可判、{@code message} 只用于人读。 */
    public record ErrorBody(String code, String message) {}
}
