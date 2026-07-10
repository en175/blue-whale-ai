package com.blue.whale.tool.mybatis.plus.handler.type;

import org.apache.ibatis.type.BaseTypeHandler;
import org.apache.ibatis.type.JdbcType;
import org.apache.ibatis.type.MappedJdbcTypes;
import org.apache.ibatis.type.MappedTypes;

import java.sql.CallableStatement;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;

/**
 * DurationTypeHandler
 *
 * @author: Jiyeon2__
 * date: 2024/8/15
 * description:
 */
@MappedTypes(Duration.class)
@MappedJdbcTypes(JdbcType.BIGINT)
public class DurationTypeHandler extends BaseTypeHandler<Duration> {
	@Override
	public void setNonNullParameter(PreparedStatement ps, int i, Duration parameter, JdbcType jdbcType) throws SQLException {
		ps.setLong(i, parameter.toMillis());
	}

	@Override
	public Duration getNullableResult(ResultSet rs, String columnName) throws SQLException {
		long value = rs.getLong(columnName);
		return value == 0 ? null : Duration.ofMillis(value);
	}

	@Override
	public Duration getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
		long value = rs.getLong(columnIndex);
		return value == 0 ? null : Duration.ofMillis(value);
	}

	@Override
	public Duration getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
		long value = cs.getLong(columnIndex);
		return value == 0 ? null : Duration.ofMillis(value);
	}
}
