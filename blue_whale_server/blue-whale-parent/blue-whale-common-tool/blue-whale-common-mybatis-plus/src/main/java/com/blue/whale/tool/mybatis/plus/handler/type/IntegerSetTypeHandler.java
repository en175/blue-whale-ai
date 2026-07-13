package com.blue.whale.tool.mybatis.plus.handler.type;

import com.alibaba.fastjson2.TypeReference;
import com.blue.whale.tool.mybatis.plus.IFastJson2TypeHandler;
import org.apache.ibatis.type.JdbcType;
import org.apache.ibatis.type.MappedJdbcTypes;
import org.apache.ibatis.type.MappedTypes;

import java.util.Set;

/**
 * IntegerSetTypeHandler
 *
 * @author: Jiyeon2__
 * date: 2024/8/15
 * description:
 */
@MappedTypes({Set.class})
@MappedJdbcTypes({JdbcType.VARCHAR})
public class IntegerSetTypeHandler extends IFastJson2TypeHandler {

	public IntegerSetTypeHandler(Class<?> type) {
		super(type);
	}

	@Override
	public TypeReference<?> getTypeReference() {
		return new TypeReference<Set<Integer>>() {
		};
	}
}
