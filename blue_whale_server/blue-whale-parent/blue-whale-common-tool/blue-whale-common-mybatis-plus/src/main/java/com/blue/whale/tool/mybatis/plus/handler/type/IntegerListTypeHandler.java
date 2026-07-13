package com.blue.whale.tool.mybatis.plus.handler.type;

import com.alibaba.fastjson2.TypeReference;
import com.blue.whale.tool.mybatis.plus.IFastJson2TypeHandler;
import org.apache.ibatis.type.JdbcType;
import org.apache.ibatis.type.MappedJdbcTypes;
import org.apache.ibatis.type.MappedTypes;

import java.util.List;

/**
 * IntegerListTypeHandler
 *
 * @author: Jiyeon2__
 * date: 2024/8/15
 * description:
 */
@MappedTypes({List.class})
@MappedJdbcTypes({JdbcType.VARCHAR})
public class IntegerListTypeHandler extends IFastJson2TypeHandler {

	public IntegerListTypeHandler(Class<?> type) {
		super(type);
	}

	@Override
	public TypeReference<?> getTypeReference() {
		return new TypeReference<List<Integer>>() {
		};
	}
}
