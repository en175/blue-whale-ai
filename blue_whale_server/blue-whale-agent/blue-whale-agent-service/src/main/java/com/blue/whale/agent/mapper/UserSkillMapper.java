package com.blue.whale.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.blue.whale.agent.model.entity.UserSkill;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;

/**
 * 用户技能引用关系 Mapper（@MapperScan 已在 AgentApplication 覆盖 com.blue.whale.agent.**.mapper）。
 */
public interface UserSkillMapper extends BaseMapper<UserSkill> {

    /**
     * upsert 引用关系。ON DUPLICATE KEY：恢复已逻辑删行（is_delete=0）并刷新 auto。
     * 走原生 SQL 绕开 @TableLogic 过滤——逻辑删行 selectList 查不到，靠唯一索引 (user_id, skill_id) 兜底。
     */
    @Insert("INSERT INTO user_skill (user_id, skill_id, auto, version, is_delete) " +
            "VALUES (#{userId}, #{skillId}, #{auto}, 0, 0) " +
            "ON DUPLICATE KEY UPDATE auto = VALUES(auto), is_delete = 0")
    int upsert(@Param("userId") Long userId, @Param("skillId") Long skillId, @Param("auto") Boolean auto);
}
