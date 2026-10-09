package com.bluewhale.billing.common.error;

import com.bluewhale.billing.api.AdminNotFoundException;
import com.bluewhale.billing.application.CatalogCompiler;
import com.bluewhale.billing.domain.ledger.InsufficientCreditsException;
import com.bluewhale.billing.domain.pricing.BasePriceResolver;
import com.bluewhale.billing.domain.pricing.PricingEngine;
import com.bluewhale.billing.domain.pricing.Usage;
import io.grpc.Status;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;

public final class BillingErrorTaxonomy {

    private BillingErrorTaxonomy() {}

    public enum Surface {
        USER,
        ADMIN,
    }

    public enum Code {
        INSUFFICIENT_CREDITS("INSUFFICIENT_CREDITS", Status.Code.FAILED_PRECONDITION,
                HttpStatus.PAYMENT_REQUIRED),
        UNPRICEABLE("UNPRICEABLE", Status.Code.INVALID_ARGUMENT, HttpStatus.BAD_REQUEST),
        DUPLICATE("DUPLICATE", Status.Code.ALREADY_EXISTS, HttpStatus.CONFLICT),
        NOT_FOUND("NOT_FOUND", Status.Code.NOT_FOUND, HttpStatus.NOT_FOUND),
        INVALID_ARGUMENT("INVALID_ARGUMENT", Status.Code.INVALID_ARGUMENT, HttpStatus.BAD_REQUEST),
        INTERNAL("INTERNAL", Status.Code.INTERNAL, HttpStatus.INTERNAL_SERVER_ERROR);

        private final String wire;
        private final Status.Code grpcCode;
        private final HttpStatus httpStatus;

        Code(String wire, Status.Code grpcCode, HttpStatus httpStatus) {
            this.wire = wire;
            this.grpcCode = grpcCode;
            this.httpStatus = httpStatus;
        }

        public String wire() {
            return wire;
        }

        public Status.Code grpcCode() {
            return grpcCode;
        }

        public HttpStatus httpStatus() {
            return httpStatus;
        }
    }

    public static final String INTERNAL_MESSAGE = "billing 内部错误";

    public static final String DUPLICATE_MESSAGE =
            "该幂等键已存在：这次操作之前已经成功过，未重复执行";

    public record Failure(Code code, String logDetail) {

        public String outwardDetail() {
            return code == Code.INTERNAL ? INTERNAL_MESSAGE : logDetail;
        }

        public String description() {
            return code == Code.INTERNAL
                    ? outwardDetail()
                    : code.wire() + ": " + outwardDetail();
        }

        public boolean internal() {
            return code == Code.INTERNAL;
        }
    }

    public static Failure classify(RuntimeException e, Surface surface) {
        if (e instanceof InsufficientCreditsException) {
            return new Failure(Code.INSUFFICIENT_CREDITS, e.getMessage());
        }
        if (e instanceof CatalogCompiler.CompileException) {
            return new Failure(
                    surface == Surface.ADMIN ? Code.INVALID_ARGUMENT : Code.UNPRICEABLE,
                    e.getMessage());
        }
        if (e instanceof PricingEngine.RuleNotFoundException
                || e instanceof BasePriceResolver.UnpriceableSpecException
                || e instanceof Usage.ContractQuantityUnavailableException) {
            return new Failure(Code.UNPRICEABLE, e.getMessage());
        }
        if (e instanceof AdminNotFoundException) {
            return new Failure(Code.NOT_FOUND, e.getMessage());
        }
        if (e instanceof DuplicateKeyException) {
            return new Failure(Code.DUPLICATE, DUPLICATE_MESSAGE);
        }
        if (e instanceof IllegalArgumentException) {
            return new Failure(Code.INVALID_ARGUMENT, e.getMessage());
        }
        return new Failure(Code.INTERNAL, e.getMessage());
    }
}
