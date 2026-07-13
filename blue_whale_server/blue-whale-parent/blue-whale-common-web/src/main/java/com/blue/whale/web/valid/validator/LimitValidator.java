package com.blue.whale.web.valid.validator;

import cn.hutool.core.convert.Convert;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.web.valid.annotation.Limit;
import lombok.extern.slf4j.Slf4j;

import javax.validation.ConstraintValidator;
import javax.validation.ConstraintValidatorContext;
import java.math.BigDecimal;

/**
 * LimitValidator
 *
 * @author: Jiyeon2__
 * date: 2024/8/16
 * description:
 */
@Slf4j
public class LimitValidator implements ConstraintValidator<Limit, Object> {


    private Limit limit;

    @Override
    public void initialize(Limit limit) {
        this.limit = limit;
    }

    @Override
    public boolean isValid(Object value, ConstraintValidatorContext context) {
        if (value == null) {
            return true;
        }
        String[] vals = limit.value();
        /*
         * 枚举的处理
         */
        if (vals.length > 0) {
            return enumValid(value, vals);
        }
        /*
         * 数字范围处理
         */
        return inRange(value, limit.min(), limit.max());
    }

    public boolean inRange(Object value, String min, String max) {
        BigDecimal val = toBigDecimal(value);
        BigDecimal minv = toBigDecimal(min);
        BigDecimal maxv = toBigDecimal(max);
        int compare = minv.compareTo(maxv);
        if (compare > 0) {
            if (log.isErrorEnabled()) {
                log.error("@Limit min max set error");
            }
            throw SystemCode.FAILURE.exception();
        } else if (compare == 0 && val.equals(minv)) {
            return true;
        }

        return val.compareTo(minv) >= 0 && val.compareTo(maxv) <= 0;
    }

    public boolean enumValid(Object value, String[] vals) {
        Class<?> valueClazz = value.getClass();
        for (String val : vals) {
            Object convert = convert(valueClazz, val);
            if (convert == null) {
                continue;
            }
            if (convert == value || convert.equals(value)) {
                return true;
            }
        }
        return false;
    }

    public BigDecimal toBigDecimal(Object value) {
        BigDecimal result;
        try {
            result = Convert.toBigDecimal(value);
        } catch (Exception ex) {
            if (log.isErrorEnabled()) {
                log.error("@Limit Usage error", ex);
            }
            throw SystemCode.FAILURE.exception();
        }
        return result;
    }


    public Object convert(Class<?> valueClazz, Object val) {
        Object result;
        try {
            result = Convert.convert(valueClazz, val);
        } catch (Exception ex) {
            if (log.isErrorEnabled()) {
                log.error("@Limit Usage error", ex);
            }
            throw SystemCode.FAILURE.exception();
        }
        return result;
    }
}
