package com.blue.whale.user.controller;

import com.blue.whale.global.base.resp.Result;
import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.user.config.SecurityUtils;
import com.blue.whale.user.dto.*;
import com.blue.whale.user.entity.User;
import com.blue.whale.user.service.AuthService;
import com.blue.whale.user.service.UserService;
import com.blue.whale.web.utils.IpUtils;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletRequest;
import javax.validation.Valid;
import java.util.Map;

/**
 * 用户接口
 */
@RestController
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;
    private final AuthService authService;

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

    /**
     * 换绑手机号——发验证码
     * POST /api/user/phone/send-code
     */
    @PostMapping("/api/user/phone/send-code")
    public Result<Map<String, Object>> sendChangePhoneCode(
            @Valid @RequestBody ChangePhoneSendCodeRequest req,
            HttpServletRequest request) {
        String userId = String.valueOf(SecurityUtils.getCurrentUserId());
        String ip = IpUtils.getIpAddr(request);
        authService.sendChangePhoneCode(userId, req.getNewPhone(), ip,
                req.getCaptchaToken(), req.getCaptchaAnswer());
        return Result.ok(Map.of("success", true, "expires_in", 300));
    }

    /**
     * 换绑手机号——校验验证码
     * PUT /api/user/phone
     */
    @PutMapping("/api/user/phone")
    public Result<Void> changePhone(@Valid @RequestBody ChangePhoneRequest req) {
        String userId = String.valueOf(SecurityUtils.getCurrentUserId());
        authService.changePhone(userId, req.getNewPhone(), req.getCode());
        return Result.ok();
    }

    /**
     * 更新用户名
     * PUT /api/user/username
     */
    @PutMapping("/api/user/username")
    public Result<Void> updateUsername(@Valid @RequestBody UpdateUsernameRequest req) {
        Long userId = SecurityUtils.getCurrentUserId();
        userService.updateUsername(userId, req.getUsername());
        return Result.ok();
    }
}
