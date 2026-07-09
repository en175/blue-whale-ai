package com.blue.whale.user.controller;

import com.blue.whale.global.base.resp.Result;
import com.blue.whale.user.service.CaptchaService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 图形验证码接口
 */
@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class CaptchaController {

    private final CaptchaService captchaService;

    /**
     * 获取图形验证码
     * GET /api/auth/captcha
     */
    @GetMapping("/captcha")
    public Result<Map<String, String>> captcha() {
        CaptchaService.CaptchaResult result = captchaService.generate();
        return Result.ok(Map.of(
                "captcha_token", result.token(),
                "captcha_image", result.base64Image()
        ));
    }
}
