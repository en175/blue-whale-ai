package com.blue.whale.agent.model.request;

import javax.validation.constraints.NotBlank;

/**
 * 重命名项目请求。
 *
 * @param name 新项目名
 */
public record RenameProjectRequest(@NotBlank(message = "项目名不能为空") String name) {
}
