package com.bluewhale.billing.common.error;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(basePackages = "com.bluewhale.billing.api")
public class AdminExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(AdminExceptionHandler.class);

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

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorBody> unreadable(HttpMessageNotReadableException e) {
        Throwable cause = e.getMostSpecificCause();
        String message = cause instanceof IllegalArgumentException
                ? cause.getMessage()
                : "请求体不是合法的 JSON 或字段类型不匹配";
        return ResponseEntity.status(BillingErrorTaxonomy.Code.INVALID_ARGUMENT.httpStatus())
                .body(new ErrorBody(BillingErrorTaxonomy.Code.INVALID_ARGUMENT.wire(), message));
    }

    @ExceptionHandler(DuplicateGrantKeyException.class)
    public ResponseEntity<ErrorBody> duplicateGrant(DuplicateGrantKeyException e) {
        return ResponseEntity.status(BillingErrorTaxonomy.Code.DUPLICATE.httpStatus())
                .body(new ErrorBody(BillingErrorTaxonomy.Code.DUPLICATE.wire(),
                        e.getMessage(), e.existingBizId()));
    }

    public record ErrorBody(String code, String message, String existingBizId) {
        public ErrorBody(String code, String message) {
            this(code, message, null);
        }
    }
}
