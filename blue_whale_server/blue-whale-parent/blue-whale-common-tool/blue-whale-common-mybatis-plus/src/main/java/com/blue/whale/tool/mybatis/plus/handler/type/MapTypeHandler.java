package com.blue.whale.tool.mybatis.plus.handler.type;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.TypeReference;
import com.blue.whale.global.base.model.KeyValue;
import com.blue.whale.tool.mybatis.plus.IFastJson2TypeHandler;
import org.apache.ibatis.type.JdbcType;
import org.apache.ibatis.type.MappedJdbcTypes;
import org.apache.ibatis.type.MappedTypes;

import java.util.Map;
import java.util.Set;

/**
 * LongListTypeHandler
 *
 * @author: Jiyeon2__
 * date: 2024/8/15
 * description: 处理复杂类型的 KEY 的 map 序列化 反序列化 处理器
 * <K> key 类型
 * <V> value 类型
 */
@MappedTypes({Map.class})
@MappedJdbcTypes({JdbcType.VARCHAR})
public abstract class MapTypeHandler<K, V> extends IFastJson2TypeHandler {


    /**
     * 获取 key value 的类型引用
     *
     * @return TypeReference
     * @see KeyValue
     */
    protected abstract TypeReference<Set<KeyValue<K, V>>> keyValueReference();

    @Override
    protected TypeReference<?> getTypeReference() {
        return keyValueReference();
    }

    @Override
    protected Object parse(String json) {
        return KeyValue.toMap(
                keyValueReference().to(JSONArray.parseArray(json))
        );
    }

    @Override
    protected String toJson(Object obj) {
        if (!(obj instanceof Map<?, ?> keyValueMap)) {
            throw new RuntimeException("MapTypeHandler only support Map");
        }
        return super.toJson(KeyValue.of(keyValueMap));
    }
}
