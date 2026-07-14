package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.mapper.ProjectMapper;
import com.blue.whale.agent.model.constant.AggregateType;
import com.blue.whale.agent.model.constant.EventType;
import com.blue.whale.agent.model.dto.CreateProjectRequest;
import com.blue.whale.agent.model.dto.ProjectDto;
import com.blue.whale.agent.model.dto.RenameProjectRequest;
import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 项目服务：workspace 根的 CRUD（ADR-0011）。写操作均校验归属（{@code ownerId}）。
 *
 * <p>写操作在同一事务内追加产品事件与 Outbox（ADR-0016/0017）；提交后由 Outbox 发布器唤醒连接，
 * SSE 始终按连接自身的 cursor 从数据库追平。
 */
@Service
@RequiredArgsConstructor
public class ProjectService {

    private final ProjectMapper projectMapper;
    private final ProjectEventService projectEventService;

    /** 新建项目。 */
    @Transactional
    public ProjectDto create(Long ownerId, CreateProjectRequest req) {
        Project p = new Project()
                .setOwnerId(ownerId)
                .setName(req.name());
        projectMapper.insert(p);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("name", p.getName());
        projectEventService.appendEvent(p.getId(), EventType.PROJECT_CREATED,
                AggregateType.PROJECT, String.valueOf(p.getId()), p.getVersion(),
                payload, null, null);
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
        projectEventService.appendEvent(p.getId(), EventType.PROJECT_RENAMED,
                AggregateType.PROJECT, String.valueOf(p.getId()), p.getVersion(),
                payload, null, null);
        return toDto(p);
    }

    /** 逻辑删除项目（canvas 残留为孤儿，MVP 不级联，见 ADR-0011 后续）。 */
    @Transactional
    public void delete(Long id, Long ownerId) {
        Project project = requireOwned(id, ownerId);
        projectMapper.deleteById(id);
        int deletedVersion = project.getVersion() == null ? 1 : project.getVersion() + 1;
        projectEventService.appendEvent(id, EventType.PROJECT_DELETED,
                AggregateType.PROJECT, String.valueOf(id), deletedVersion,
                Map.of("project_id", id), null, null);
    }

    /**
     * 取 project 并校验归属：不存在与越权统一抛 {@link SystemCode#RESOURCE_NOT_FOUND_CODE}，
     * 避免泄漏资源存在性。供 {@code CanvasController} 复用。
     */
    public Project requireOwned(Long projectId, Long ownerId) {
        return assertOwned(projectMapper.selectById(projectId), ownerId);
    }

    /** 在调用方事务内锁定 Project 并校验归属，防止状态写入越过并发删除。 */
    public Project requireOwnedForUpdate(Long projectId, Long ownerId) {
        return assertOwned(projectMapper.selectForUpdate(projectId), ownerId);
    }

    private Project assertOwned(Project p, Long ownerId) {
        if (p == null) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        if (!ownerId.equals(p.getOwnerId())) {
            throw new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在");
        }
        return p;
    }

    private ProjectDto toDto(Project p) {
        return new ProjectDto(p.getId(), p.getName(), p.getThumb(), p.getGmtCreate());
    }

}
