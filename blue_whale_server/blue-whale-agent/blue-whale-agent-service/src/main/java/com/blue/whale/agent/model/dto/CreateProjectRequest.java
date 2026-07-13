package com.blue.whale.agent.model.dto;

import javax.validation.constraints.NotBlank;

/**
 * 创建项目请求。
 *
 * @param name 项目名
 */
public record CreateProjectRequest(@NotBlank(message = "项目名不能为空") String name) {
}
