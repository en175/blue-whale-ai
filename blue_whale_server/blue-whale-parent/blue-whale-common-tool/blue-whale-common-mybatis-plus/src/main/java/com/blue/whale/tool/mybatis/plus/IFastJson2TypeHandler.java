package com.blue.whale.tool.mybatis.plus;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.TypeReference;
import com.baomidou.mybatisplus.extension.handlers.AbstractJsonTypeHandler;
import com.blue.whale.tool.fastjson2.FastJson2;

/**
 * 自定义抽象 type handler 处理器
 *
 * @author: Jiyeon2__
 * date: 2024/8/15
 * description:
 */
public abstract class IFastJson2TypeHandler extends AbstractJsonTypeHandler<Object> {

    public IFastJson2TypeHandler(Class<?> type) {
        super(type);
    }

    /**
     * 获取泛型的 TypeReference
     *
     * @return TypeReference
     */
    protected abstract TypeReference<?> getTypeReference();

    @Override
    public Object parse(String json) {
        return JSON.parseObject(json, getTypeReference(), FastJson2.readFeature());
    }

    @Override
    public String toJson(Object obj) {
        return JSON.toJSONString(obj, FastJson2.writeFeature());
    }
}
