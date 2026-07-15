package com.blue.whale.agent.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

public interface CostBudgetLockMapper {

    @Insert("INSERT INTO cost_budget_locks(scope_key) VALUES(#{scopeKey}) "
            + "ON DUPLICATE KEY UPDATE scope_key = scope_key")
    int ensureExists(@Param("scopeKey") String scopeKey);

    @Select("SELECT scope_key FROM cost_budget_locks WHERE scope_key = #{scopeKey} FOR UPDATE")
    String lock(@Param("scopeKey") String scopeKey);
}
