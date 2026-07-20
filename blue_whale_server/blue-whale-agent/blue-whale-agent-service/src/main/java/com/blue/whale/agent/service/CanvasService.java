package com.blue.whale.agent.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.blue.whale.agent.mapper.CanvasMapper;
import com.blue.whale.agent.model.dto.CanvasDto;
import com.blue.whale.agent.model.request.SaveCanvasRequest;
import com.blue.whale.agent.model.entity.Canvas;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 画布服务：整体 JSON 透传（ADR-0011 D3/D4）。与 project 1:1，按 {@code projectId} upsert。
 * 归属校验由 Controller 调 {@code ProjectService.requireOwned} 完成，本服务不重复校验。
 */
@Service
@RequiredArgsConstructor
public class CanvasService {

    private final CanvasMapper canvasMapper;

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
    public CanvasDto save(Long projectId, SaveCanvasRequest req) {
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
        return toDto(c);
    }

    private CanvasDto toDto(Canvas c) {
        return new CanvasDto(c.getId(), c.getProjectId(), c.getViewportJson(), c.getNodesJson());
    }
}
