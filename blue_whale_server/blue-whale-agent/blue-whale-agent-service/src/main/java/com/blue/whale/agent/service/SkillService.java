package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.blue.whale.agent.mapper.SkillMapper;
import com.blue.whale.agent.mapper.UserSkillMapper;
import com.blue.whale.agent.model.dto.ItemsVo;
import com.blue.whale.agent.model.dto.SkillLibraryDto;
import com.blue.whale.agent.model.dto.SkillLibraryQuery;
import com.blue.whale.agent.model.dto.SkillMineQuery;
import com.blue.whale.agent.model.dto.SkillMineDto;
import com.blue.whale.agent.model.entity.Skill;
import com.blue.whale.agent.model.entity.UserSkill;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 技能面板服务。关系模型：库(skill) ⊃ 我的(user_skill 引用)，auto 挂关系上。
 *
 * <p>library 分页（POST，默认 50/页，可按 keyword 搜 name/description）；
 * mine join skill 返完整内容快照，my tab 数据自足（不受 library 分页影响）。
 * 封面直接取 skill.cover_url（普通图 URL），无签名签发。
 */
@Service
@RequiredArgsConstructor
public class SkillService {

    private final SkillMapper skillMapper;
    private final UserSkillMapper userSkillMapper;

    /** 系统内置 skill 分页（source=official），可按 keyword 搜 name/description */
    public Page<SkillLibraryDto> listLibrary(Long userId, SkillLibraryQuery q) {
        Page<Skill> page = new Page<>(q.getPageNum(), q.getPageSize());
        LambdaQueryWrapper<Skill> wrapper = new LambdaQueryWrapper<Skill>();
        wrapper.select(Skill.class, info -> !info.getColumn().equals("content"))
                // 使用 Lambda 表达式替代字符串
                .eq(Skill::getSource, "official")
                // 使用 Lambda 的 and 条件，用 condition 参数控制
                .and(StringUtils.hasText(q.getKeyword()),
                        w -> w.like(Skill::getName, q.getKeyword())
                                .or()
                                .like(Skill::getDescription, q.getKeyword()))
                // 使用 Lambda 排序
                .orderByAsc(Skill::getSortOrder);
        IPage<Skill> result = skillMapper.selectPage(page, wrapper);

        Set<Long> mineIds = userSkillMapper.selectList(
                        new LambdaQueryWrapper<UserSkill>().eq(UserSkill::getUserId, userId).select(UserSkill::getSkillId))
                .stream().map(UserSkill::getSkillId).collect(Collectors.toSet());

        List<SkillLibraryDto> records = result.getRecords().stream()
                .map(s -> new SkillLibraryDto()
                        .setId(s.getId())
                        .setName(s.getName())
                        .setDescription(s.getDescription())
                        .setCoverUrl(s.getCoverUrl())
                        .setSource(s.getSource())
                        .setAdded(mineIds.contains(s.getId())))
                .collect(Collectors.toList());

        Page<SkillLibraryDto> resp = new Page<>(result.getCurrent(), result.getSize(), result.getTotal());
        resp.setRecords(records);
        return resp;
    }

    /** user 已添加子集分页 + auto + skill 内容快照（join，my tab 自足，与 library 一致滚动加载） */
    public Page<SkillMineDto> listMine(Long userId, SkillMineQuery q) {
        Page<UserSkill> page = new Page<>(q.getPageNum(), q.getPageSize());
        LambdaQueryWrapper<UserSkill> wrapper = new LambdaQueryWrapper<UserSkill>()
                .eq(UserSkill::getUserId, userId).orderByAsc(UserSkill::getSkillId);
        IPage<UserSkill> result = userSkillMapper.selectPage(page, wrapper);

        List<UserSkill> rels = result.getRecords();
        if (rels.isEmpty()) {
            Page<SkillMineDto> empty = new Page<>(result.getCurrent(), result.getSize(), result.getTotal());
            empty.setRecords(Collections.emptyList());
            return empty;
        }
        List<Long> skillIds = rels.stream().map(UserSkill::getSkillId).collect(Collectors.toList());
        // 排除 content（md 大字段），与 listLibrary 一致省内存
        LambdaQueryWrapper<Skill> skillWrapper = new LambdaQueryWrapper<Skill>()
                .select(Skill.class, info -> !info.getColumn().equals("content"))
                .in(Skill::getId, skillIds);
        Map<Long, Skill> skillMap = skillMapper.selectList(skillWrapper).stream()
                .collect(Collectors.toMap(Skill::getId, Function.identity()));
        List<SkillMineDto> items = rels.stream()
                .map(r -> {
                    Skill s = skillMap.get(r.getSkillId());
                    return new SkillMineDto()
                            .setSkillId(r.getSkillId())
                            .setAuto(r.getAuto())
                            .setName(s == null ? null : s.getName())
                            .setDescription(s == null ? null : s.getDescription())
                            .setCoverUrl(s == null ? null : s.getCoverUrl())
                            .setSource(s == null ? null : s.getSource());
                })
                .collect(Collectors.toList());
        Page<SkillMineDto> resp = new Page<>(result.getCurrent(), result.getSize(), result.getTotal());
        resp.setRecords(items);
        return resp;
    }

    /** 建立引用（加入「我的」，默认 auto=false）。ON DUPLICATE KEY 恢复已逻辑删行 */
    public void add(Long userId, Long skillId) {
        requireSkill(skillId);
        userSkillMapper.upsert(userId, skillId, false);
    }

    /** 解除引用（逻辑删，不删 skill 本身） */
    public void remove(Long userId, Long skillId) {
        userSkillMapper.delete(new LambdaQueryWrapper<UserSkill>()
                .eq(UserSkill::getUserId, userId).eq(UserSkill::getSkillId, skillId));
    }

    /** 改关系上的 auto 开关 */
    public void updateAuto(Long userId, Long skillId, Boolean auto) {
        UserSkill update = new UserSkill().setAuto(auto);
        int rows = userSkillMapper.update(update, new LambdaQueryWrapper<UserSkill>()
                .eq(UserSkill::getUserId, userId).eq(UserSkill::getSkillId, skillId));
        if (rows == 0) {
            throw new GlobalException(SystemCode.DATA_NOT_EXIST_CODE, "未添加该 Skill，无法设置 auto");
        }
    }

    private Skill requireSkill(Long skillId) {
        Skill skill = skillMapper.selectById(skillId);
        if (skill == null) {
            throw new GlobalException(SystemCode.DATA_NOT_EXIST_CODE, "Skill 不存在: " + skillId);
        }
        return skill;
    }
}
