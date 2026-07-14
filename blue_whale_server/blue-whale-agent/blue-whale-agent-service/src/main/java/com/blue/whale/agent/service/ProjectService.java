package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.model.constant.AggregateType;
import com.blue.whale.agent.model.constant.EventType;
import com.blue.whale.agent.model.dto.CreateProjectRequest;
import com.blue.whale.agent.model.dto.ProductEventDto;
import com.blue.whale.agent.model.dto.ProjectDto;
import com.blue.whale.agent.model.dto.RenameProjectRequest;
import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.agent.model.entity.ProjectEvent;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 项目服务：workspace 根的 CRUD（ADR-0011）。写操作均校验归属（{@code ownerId}）。
 *
 * <p>{@code create}/{@code rename} 在同一事务内追加产品事件（ADR-0016/0017），事务提交后才推实时 SSE，
 * 保证 SSE 订阅者按 cursor 重放不会漏（复用 {@code GenerationJobService.triggerStreamAfterCommit} 同款范式）。
 */
@Service
@RequiredArgsConstructor
public class ProjectService {

    private final ProjectMapper projectMapper;
    private final ProjectEventService projectEventService;
    private final ProjectEventBus eventBus;

    /** 新建项目。 */
    @Transactional
    public ProjectDto create(Long ownerId, CreateProjectRequest req) {
        Project p = new Project()
                .setOwnerId(ownerId)
                .setName(req.name());
        projectMapper.insert(p);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("name", p.getName());
        ProjectEvent event = projectEventService.appendEvent(p.getId(), EventType.PROJECT_CREATED,
                AggregateType.PROJECT, String.valueOf(p.getId()), p.getVersion(),
                payload, null, null);
        publishAfterCommit(event);
        return toDto(p);
    }

    /** 列出用户下全部项目（按创建时间倒序）。 */
    public List<ProjectDto> list(Long ownerId) {
        return projectMapper.selectList(
                        Wrappers.<Project>lambdaQuery()
                                .eq(Project::getOwnerId, ownerId)
                                .orderByDesc(Project::getGmtCreate))
                .stream()
                .map(this::toDto)
                .toList();
    }

    /** 取单个项目。 */
    public ProjectDto get(Long id, Long ownerId) {
        return toDto(requireOwned(id, ownerId));
    }

    /** 重命名项目。 */
    @Transactional
    public ProjectDto rename(Long id, Long ownerId, RenameProjectRequest req) {
        Project p = requireOwned(id, ownerId);
        p.setName(req.name());
        projectMapper.updateById(p);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("name", p.getName());
        ProjectEvent event = projectEventService.appendEvent(p.getId(), EventType.PROJECT_RENAMED,
                AggregateType.PROJECT, String.valueOf(p.getId()), p.getVersion(),
                payload, null, null);
        publishAfterCommit(event);
        return toDto(p);
    }

    /** 逻辑删除项目（canvas 残留为孤儿，MVP 不级联，见 ADR-0011 后续）。 */
    public void delete(Long id, Long ownerId) {
        requireOwned(id, ownerId);
        projectMapper.deleteById(id);
    }

    /**
     * 取 project 并校验归属：不存在抛 {@link SystemCode#DATA_NOT_EXIST_CODE}，
     * 越权抛 {@link SystemCode#DATA_NO_PERMISSION_OPERATE_CODE}。供 {@code CanvasController} 复用。
     */
    public Project requireOwned(Long projectId, Long ownerId) {
        Project p = projectMapper.selectById(projectId);
        if (p == null) {
            throw new GlobalException(SystemCode.DATA_NOT_EXIST_CODE, "项目不存在");
        }
        if (!ownerId.equals(p.getOwnerId())) {
            throw new GlobalException(SystemCode.DATA_NO_PERMISSION_OPERATE_CODE, "无权限操作该项目");
        }
        return p;
    }

    private ProjectDto toDto(Project p) {
        return new ProjectDto(p.getId(), p.getName(), p.getThumb(), p.getGmtCreate());
    }

    /** 事务提交后才推实时 SSE（保证订阅者按 cursor 重放不漏）；无事务上下文则直接推。 */
    private void publishAfterCommit(ProjectEvent event) {
        ProductEventDto dto = ProductEventDto.from(event);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    eventBus.publish(event.getProjectId(), dto);
                }
            });
        } else {
            eventBus.publish(event.getProjectId(), dto);
        }
    }
}
