package com.blue.whale.web.valid.annotation;


import com.blue.whale.web.valid.validator.PriceValidator;

import javax.validation.Constraint;
import javax.validation.Payload;
import java.lang.annotation.*;

import static java.lang.annotation.RetentionPolicy.RUNTIME;

/**
 * Price
 *
 * @author: Jiyeon2__
 * date: 2024/8/16
 * description: 最低限额
 */
@Documented
@Target({ElementType.FIELD, ElementType.PARAMETER})
@Retention(RUNTIME)
@Repeatable(Price.Prices.class)
@Constraint(validatedBy = {PriceValidator.class})
public @interface Price {

    String message() default "com.bw.butler.common.web.valid.annotation.Price.massage";


    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    @Target({ElementType.FIELD, ElementType.PARAMETER})
    @Retention(RUNTIME)
    @Documented
    @interface Prices {
        Price[] value();
    }
}
