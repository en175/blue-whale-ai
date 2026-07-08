package com.blue.whale.tool.mybatis.plus;


import com.alibaba.fastjson2.JSON;
import com.baomidou.mybatisplus.core.toolkit.Assert;
import com.baomidou.mybatisplus.extension.handlers.AbstractJsonTypeHandler;
import com.blue.whale.tool.fastjson2.FastJson2;
import lombok.extern.slf4j.Slf4j;
import org.apache.ibatis.type.JdbcType;
import org.apache.ibatis.type.MappedJdbcTypes;
import org.apache.ibatis.type.MappedTypes;


/**
 * FastJson2TypeHandler
 *
 * @author: Jiyeon2__
 * date: 2025/3/27
 * description:
 */
@Slf4j
@MappedTypes({Object.class})
@MappedJdbcTypes(JdbcType.VARCHAR)
public class FastJson2TypeHandler extends AbstractJsonTypeHandler<Object> {

    private final Class<?> type;

    public FastJson2TypeHandler(Class<?> type) {
        if (log.isTraceEnabled()) {
            log.trace("FastJson2TypeHandler(" + type + ")");
        }
        Assert.notNull(type, "Type argument cannot be null");
        this.type = type;
    }

    @Override
    protected Object parse(String json) {
        return JSON.parseObject(json, type, FastJson2.readFeature());
    }

    @Override
    protected String toJson(Object obj) {
        return JSON.toJSONString(obj, FastJson2.writeFeature());
    }
}
