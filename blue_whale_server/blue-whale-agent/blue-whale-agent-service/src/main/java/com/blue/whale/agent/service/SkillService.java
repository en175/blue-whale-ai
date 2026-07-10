package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.blue.whale.agent.model.dto.SkillLibraryDto;
import com.blue.whale.agent.model.dto.SkillLibraryQuery;
import com.blue.whale.agent.model.dto.SkillMineDto;
import com.blue.whale.agent.model.dto.SkillMineQuery;

/**
 * 技能面板服务。关系模型：库(skill) ⊃ 我的(user_skill 引用)，auto 挂关系上。
 *
 * <p>实现见 {@link com.blue.whale.agent.service.impl.SkillServiceImpl}。
 */
public interface SkillService {

    /** 系统内置 skill 分页（source=official），可按 keyword 搜 name/description */
    Page<SkillLibraryDto> listLibrary(Long userId, SkillLibraryQuery q);

    /** user 已添加子集分页 + auto + skill 内容快照（join，my tab 自足，与 library 一致滚动加载） */
    Page<SkillMineDto> listMine(Long userId, SkillMineQuery q);

    /** 建立引用（加入「我的」，默认 auto=false）。ON DUPLICATE KEY 恢复已逻辑删行 */
    void add(Long userId, Long skillId);

    /** 解除引用（逻辑删，不删 skill 本身） */
    void remove(Long userId, Long skillId);

    /** 改关系上的 auto 开关 */
    void updateAuto(Long userId, Long skillId, Boolean auto);
}
