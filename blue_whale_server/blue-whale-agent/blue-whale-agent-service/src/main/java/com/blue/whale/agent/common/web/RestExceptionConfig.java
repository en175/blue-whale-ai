package com.blue.whale.agent.common.web;

import com.blue.whale.global.base.resp.Result;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DataAccessException;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.transaction.TransactionException;
import org.springframework.validation.BindException;
import org.springframework.validation.BindingResult;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import javax.validation.ConstraintViolation;
import javax.validation.ConstraintViolationException;
import java.util.Set;

/**
 * 全局异常处理：把可预见异常统一转为 {@link Result}。Boot 2.7 使用 {@code javax.validation}。
 */
@Slf4j
@Order(Ordered.HIGHEST_PRECEDENCE + 1000)
@RestControllerAdvice
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class RestExceptionConfig {

    @ExceptionHandler(GlobalException.class)
    public Result<Object> handlerGlobalException(GlobalException exception) {
        log.debug("global exception", exception);
        Result<Object> failed = Result.failed(exception.code(), exception.msg());
        failed.setData(exception.getData());
        return failed;
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    public Result<Object> handleError(MissingServletRequestParameterException exception) {
        log.debug("param valid error", exception);
        String message = String.format("缺少必要的请求参数: %s", exception.getParameterName());
        return Result.failed(SystemCode.PARAM_MISS, message);
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public Result<Object> handleError(MethodArgumentTypeMismatchException e) {
        log.debug("wrong param type", e);
        String message = String.format("请求参数格式错误: %s", e.getName());
        return Result.failed(SystemCode.PARAM_TYPE_ERROR, message);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public Result<Object> handleError(MethodArgumentNotValidException e) {
        log.debug("param valid error", e);
        return handleError(e.getBindingResult());
    }

    @ExceptionHandler(BindException.class)
    public Result<Object> handleError(BindException e) {
        log.debug("param bind error", e);
        return handleError(e.getBindingResult());
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public Result<Object> handleError(ConstraintViolationException e) {
        log.debug("param valid error", e);
        return handleError(e.getConstraintViolations());
    }

    @ExceptionHandler(DataAccessException.class)
    public Result<Object> handleError(DataAccessException e) {
        log.error("data access error", e);
        Throwable root = e.getMostSpecificCause() != null ? e.getMostSpecificCause() : e;
        String rootMsg = root.getMessage() != null ? root.getMessage() : e.getMessage();
        return Result.failed(500, "数据库错误: " + rootMsg);
    }

    @ExceptionHandler(TransactionException.class)
    public Result<Object> handleError(TransactionException e) {
        log.error("transaction error", e);
        Throwable root = e.getMostSpecificCause() != null ? e.getMostSpecificCause() : e;
        String rootMsg = root.getMessage() != null ? root.getMessage() : e.getMessage();
        return Result.failed(500, "数据库错误: " + rootMsg);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public Result<Object> handleError(HttpMessageNotReadableException e) {
        log.debug("param read error", e);
        return Result.failed(SystemCode.MSG_NOT_READABLE);
    }

    /** 处理 BindingResult（@RequestBody @Valid 与表单绑定）。 */
    protected Result<Object> handleError(BindingResult result) {
        FieldError error = result.getFieldError();
        if (error == null) {
            return Result.failed(SystemCode.PARAM_BIND_ERROR, SystemCode.PARAM_BIND_ERROR.getMsg());
        }
        String message = String.format("%s:%s", error.getField(), error.getDefaultMessage());
        return Result.failed(SystemCode.PARAM_BIND_ERROR, message);
    }

    /** 处理 ConstraintViolation（@RequestParam / @PathVariable @Validated）。 */
    protected Result<Object> handleError(Set<ConstraintViolation<?>> violations) {
        ConstraintViolation<?> violation = violations.iterator().next();
        String path = violation.getPropertyPath().toString();
        String message = String.format("%s:%s", path, violation.getMessage());
        return Result.failed(SystemCode.PARAM_VALID_ERROR, message);
    }
}
