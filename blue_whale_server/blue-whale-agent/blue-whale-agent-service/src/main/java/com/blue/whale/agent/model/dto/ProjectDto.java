package com.blue.whale.agent.model.dto;

import java.time.LocalDateTime;

/**
 * 项目响应（项目下拉菜单 / 列表）。不暴露 {@code ownerId}（归属由后端管）。
 *
 * @param id        项目 id
 * @param name      项目名
 * @param thumb     缩略图 url
 * @param createdAt 创建时间（前端 snake_case：{@code created_at}）
 * @param purpose   项目用途（{@code canvas} / {@code generation_inbox}）
 */
public record ProjectDto(Long id, String name, String thumb, LocalDateTime createdAt, String purpose) {
}
