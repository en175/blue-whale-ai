package com.blue.whale.global.constants;

import java.math.BigDecimal;
import java.util.List;

/**
 * UserContextHolder
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description: 常量池
 */
public interface CommonPool {
    /****************  BigDecimal  *****************/
    BigDecimal MIN = new BigDecimal("0.01");
    /****************  数字常量  *****************/
    Integer NUMBER_ZERO = 0;
    Integer NUMBER_ONE = 1;
    Integer NUMBER_TWO = 2;
    Integer NUMBER_THREE = 3;
    Integer NUMBER_FOUR = 4;
    Integer NUMBER_FIVE = 5;
    Integer NUMBER_SIX = 6;
    Integer NUMBER_SEVEN = 7;
    Integer NUMBER_EIGHT = 8;
    Integer NUMBER_NINE = 9;
    Integer NUMBER_TEN = 10;
    Integer NUMBER_TWELVE = 12;
    Integer NUMBER_FIFTEEN = 15;
    Integer NUMBER_THIRTY = 30;
    Integer NUMBER_NINETY = 90;
    Integer NUMBER_HUNDRED = 100;

    /****************  sql常量  *****************/
    String SQL_LIMIT = "LIMIT {},{}";
    String SQL_LIMIT_1 = "LIMIT 1";

    /************** String常量*******************/
    String CODE = "code";

    /**
     * 手机区号
     */
    String NATION_CODE = "86";


    /************** 单位转换常量 *********************/
    Long UNIT_CONVERSION_TEN_THOUSAND = 10000L;

    Long UNIT_CONVERSION_HUNDRED = 100L;


    BigDecimal BIG_DECIMAL_UNIT_CONVERSION_TEN_THOUSAND = new BigDecimal("10000");

    BigDecimal BIG_DECIMAL_UNIT_CONVERSION_HUNDRED = new BigDecimal("100");

    BigDecimal BIG_DECIMAL_UNIT_CONVERSION_THOUSAND = new BigDecimal("1000");

    String CSV_CHANGE_TXT = "\t";
    String CSV_CELL_SPLIT = ",";
    String CSV_ROW_SPLIT = "\n";

    List<Integer> QUARTER_MONTH = List.of(3, 6, 9, 12);
}
