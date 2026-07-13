package com.blue.whale.global.utils;


import com.blue.whale.global.constants.CommonPool;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Objects;

/**
 * BigDecimalUtils
 *
 * @author: Jiyeon2__
 * date: 2025/8/12
 * description: 科学计数法
 */
public class BigDecimalUtils {

    /**
     * 元换分
     *
     * @param yuan 元金额
     * @return 分金额
     */
    public static Long yuan2fen(String yuan) {
        if (Objects.isNull(yuan)) {
            return null;
        }
        return new BigDecimal(yuan).multiply(CommonPool.BIG_DECIMAL_UNIT_CONVERSION_HUNDRED)
                .setScale(0, RoundingMode.HALF_UP)
                .longValue();
    }
}
