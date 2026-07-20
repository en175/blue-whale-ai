package com.blue.whale.user.controller;

import com.blue.whale.global.base.resp.Result;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.user.dto.LoginRequest;
import com.blue.whale.user.dto.LoginResponse;
import com.blue.whale.user.dto.PasswordLoginRequest;
import com.blue.whale.user.dto.SendCodeRequest;
import com.blue.whale.user.dto.SetPasswordRequest;
import com.blue.whale.user.service.AuthService;
import com.blue.whale.web.utils.IpUtils;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.servlet.http.HttpServletRequest;
import javax.validation.Valid;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @PostMapping("/send-code")
    public Result<Map<String, Object>> sendCode(@Valid @RequestBody SendCodeRequest req,
                                                 HttpServletRequest request) {
        String ip = IpUtils.getIpAddr(request);
        authService.sendCode(req.getPhone(), ip);
        return Result.ok(Map.of("success", true, "expires_in", 300));
    }

    @PostMapping("/login")
    public Result<LoginResponse> login(@Valid @RequestBody LoginRequest req) {
        return Result.ok(authService.login(req.getPhone(), req.getCode()));
    }

    @PostMapping("/refresh")
    public Result<LoginResponse> refresh(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header == null || !header.startsWith("Bearer ")) {
            throw new GlobalException(SystemCode.UNAUTHORIZED_CODE, "缺少 refresh_token");
        }
        return Result.ok(authService.refresh(header.substring(7)));
    }

    @PostMapping("/logout")
    public Result<Void> logout(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            authService.logout(header.substring(7));
        }
        return Result.ok();
    }

    @PostMapping("/login/password")
    public Result<LoginResponse> passwordLogin(@Valid @RequestBody PasswordLoginRequest req) {
        return Result.ok(authService.passwordLogin(req.getAccount(), req.getPassword()));
    }

    @PostMapping("/set-password")
    public Result<Void> setPassword(@Valid @RequestBody SetPasswordRequest req,
                                     @RequestHeader("X-User-Id") Long userId) {
        authService.setPassword(userId, req.getCode(), req.getPassword());
        return Result.ok();
    }
}
