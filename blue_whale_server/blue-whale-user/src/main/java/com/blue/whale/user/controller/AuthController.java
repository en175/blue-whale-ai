package com.blue.whale.user.controller;

import com.blue.whale.global.base.resp.Result;
import com.blue.whale.user.dto.LoginRequest;
import com.blue.whale.user.dto.LoginResponse;
import com.blue.whale.user.dto.SendCodeRequest;
import com.blue.whale.user.service.AuthService;
import com.blue.whale.web.utils.IpUtils;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.servlet.http.HttpServletRequest;
import javax.validation.Valid;
import java.util.Map;

/**
 * 认证接口：发验证码 + 登录
 */
@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    /**
     * 发送短信验证码
     * POST /api/auth/send-code
     */
    @PostMapping("/send-code")
    public Result<Map<String, Object>> sendCode(@Valid @RequestBody SendCodeRequest req,
                                                 HttpServletRequest request) {
        String ip = IpUtils.getIpAddr(request);
        authService.sendCode(req.getPhone(), ip, req.getCaptchaToken(), req.getCaptchaAnswer());
        return Result.ok(Map.of("success", true, "expires_in", 300));
    }

    /**
     * 登录/注册
     * POST /api/auth/login
     */
    @PostMapping("/login")
    public Result<LoginResponse> login(@Valid @RequestBody LoginRequest req) {
        LoginResponse resp = authService.login(req.getPhone(), req.getCode());
        return Result.ok(resp);
    }
}
