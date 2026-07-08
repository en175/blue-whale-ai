package com.blue.whale.web.valid.annotation;


import com.blue.whale.web.valid.validator.LimitValidator;

import javax.validation.Constraint;
import javax.validation.Payload;
import javax.validation.constraints.NotNull;
import java.lang.annotation.*;

import static java.lang.annotation.RetentionPolicy.RUNTIME;

/**
 * Limit
 *
 * @author: Jiyeon2__
 * date: 2024/8/16
 * description: valid 支持枚举/范围类型的注解
 */
@Target({ElementType.FIELD,ElementType.PARAMETER})
@Retention(RUNTIME)
@Documented
@Repeatable(Limit.Limits.class)
@Constraint(validatedBy = {LimitValidator.class})
@NotNull
public @interface Limit {

    String message() default "com.bw.butler.common.web.valid.Limit.message";


    String[] value() default {};


    String min() default "0";

    String max() default "10";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default { };

    @Target({ElementType.FIELD,ElementType.PARAMETER})
    @Retention(RUNTIME)
    @Documented
    @interface Limits{
        Limit[] value();
    }
}
