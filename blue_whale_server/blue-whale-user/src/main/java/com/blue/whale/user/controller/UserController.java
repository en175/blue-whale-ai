package com.blue.whale.user.controller;

import com.blue.whale.global.base.resp.Result;
import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.user.config.SecurityUtils;
import com.blue.whale.user.dto.UserInfoResponse;
import com.blue.whale.user.entity.User;
import com.blue.whale.user.service.UserService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 用户接口
 */
@RestController
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;

    /**
     * 获取当前用户信息
     * GET /api/me
     */
    @GetMapping("/api/me")
    public Result<UserInfoResponse> me() {
        Long userId = SecurityUtils.getCurrentUserId();
        User user = userService.getById(userId);
        if (user == null) {
            throw new GlobalException(401, "用户不存在");
        }

        return Result.ok(UserInfoResponse.builder()
                .userId(user.getId())
                .username(user.getUsername())
                .phone(user.getPhone())
                .build());
    }
}
