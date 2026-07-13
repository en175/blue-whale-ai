package com.blue.whale.agent.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.blue.whale.agent.mapper.SkillMapper;
import com.blue.whale.agent.mapper.UserSkillMapper;
import com.blue.whale.agent.model.dto.SkillLibraryDto;
import com.blue.whale.agent.model.dto.SkillLibraryQuery;
import com.blue.whale.agent.model.dto.SkillMineDto;
import com.blue.whale.agent.model.dto.SkillMineQuery;
import com.blue.whale.agent.model.entity.Skill;
import com.blue.whale.agent.model.entity.UserSkill;
import com.blue.whale.agent.service.SkillService;
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
 * 技能面板服务实现。
 *
 * <p>library 分页（POST，默认 50/页，可按 keyword 搜 name/description）；
 * mine join skill 返完整内容快照（均排除 content 大字段），my tab 数据自足。
 */
@Service
@RequiredArgsConstructor
public class SkillServiceImpl implements SkillService {

    private final SkillMapper skillMapper;
    private final UserSkillMapper userSkillMapper;

    @Override
    public Page<SkillLibraryDto> listLibrary(Long userId, SkillLibraryQuery q) {
        Page<Skill> page = new Page<>(q.getPageNum(), q.getPageSize());
        LambdaQueryWrapper<Skill> wrapper = new LambdaQueryWrapper<Skill>();
        wrapper.select(Skill.class, info -> !info.getColumn().equals("content"))
                .eq(Skill::getSource, "official")
                .and(StringUtils.hasText(q.getKeyword()),
                        w -> w.like(Skill::getName, q.getKeyword())
                                .or()
                                .like(Skill::getDescription, q.getKeyword()))
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

    @Override
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

    @Override
    public void add(Long userId, Long skillId) {
        requireSkill(skillId);
        userSkillMapper.upsert(userId, skillId, false);
    }

    @Override
    public void remove(Long userId, Long skillId) {
        userSkillMapper.delete(new LambdaQueryWrapper<UserSkill>()
                .eq(UserSkill::getUserId, userId).eq(UserSkill::getSkillId, skillId));
    }

    @Override
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
