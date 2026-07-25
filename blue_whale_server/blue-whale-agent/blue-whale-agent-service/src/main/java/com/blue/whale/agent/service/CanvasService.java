package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.mapper.CanvasMapper;
import com.blue.whale.agent.model.constant.AggregateType;
import com.blue.whale.agent.model.constant.EventType;
import com.blue.whale.agent.model.dto.CanvasDto;
import com.blue.whale.agent.model.dto.SaveCanvasRequest;
import com.blue.whale.agent.model.entity.Canvas;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 画布服务：整体 JSON 透传（ADR-0011 D3/D4）。与 project 1:1，按 {@code projectId} upsert。
 * 归属校验由 Controller 调 {@code ProjectService.requireOwned} 完成，本服务不重复校验。
 */
@Service
@RequiredArgsConstructor
public class CanvasService {

    private final CanvasMapper canvasMapper;
    private final ProjectEventService projectEventService;
    private final ProjectService projectService;

    /** 按 project 取画布；无记录返空壳（{@code nodes=[]}）。 */
    public CanvasDto getByProject(Long projectId) {
        Canvas c = canvasMapper.selectOne(
                Wrappers.<Canvas>lambdaQuery().eq(Canvas::getProjectId, projectId));
        if (c == null) {
            return new CanvasDto(null, projectId, null, "[]");
        }
        return toDto(c);
    }

    /** upsert 画布（按 projectId）。整体覆盖 {@code viewport} 与 {@code nodes}。 */
    @Transactional
    public CanvasDto save(Long projectId, Long ownerId, SaveCanvasRequest req) {
        projectService.requireOwnedForUpdate(projectId, ownerId);
        Canvas c = canvasMapper.selectOne(
                Wrappers.<Canvas>lambdaQuery().eq(Canvas::getProjectId, projectId));
        if (c == null) {
            c = new Canvas()
                    .setProjectId(projectId)
                    .setViewportJson(req.viewport())
                    .setNodesJson(req.nodes());
            canvasMapper.insert(c);
        } else {
            c.setViewportJson(req.viewport())
                    .setNodesJson(req.nodes());
            canvasMapper.updateById(c);
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("viewport", req.viewport());
        payload.put("nodes", req.nodes());
        projectEventService.appendEvent(projectId, EventType.CANVAS_UPDATED,
                AggregateType.CANVAS, String.valueOf(c.getId()), c.getVersion(),
                payload, null, null);
        return toDto(c);
    }

    private CanvasDto toDto(Canvas c) {
        return new CanvasDto(c.getId(), c.getProjectId(), c.getViewportJson(), c.getNodesJson());
    }
}
