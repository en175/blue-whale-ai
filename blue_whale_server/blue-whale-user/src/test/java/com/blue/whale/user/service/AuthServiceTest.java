package com.blue.whale.user.service;

import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.user.config.JwtUtil;
import com.blue.whale.user.config.JwtConfig;
import com.blue.whale.user.entity.User;
import com.blue.whale.user.entity.VerificationCode;
import com.blue.whale.user.mapper.UserMapper;
import com.blue.whale.user.mapper.VerificationCodeMapper;
import com.blue.whale.user.sms.ConsoleSmsProvider;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

    @Mock private UserMapper userMapper;
    @Mock private VerificationCodeMapper verificationCodeMapper;
    @Mock private CaptchaService captchaService;
    @Spy private ConsoleSmsProvider smsProvider;

    private AuthService authService;

    @BeforeEach
    void setUp() {
        JwtConfig jwtConfig = new JwtConfig();
        jwtConfig.setSecret("test-secret-key-for-unit-tests-at-least-256-bits!!");
        jwtConfig.setExpiration(604800L);
        JwtUtil jwtUtil = new JwtUtil(jwtConfig);
        authService = new AuthService(userMapper, verificationCodeMapper, captchaService, smsProvider, jwtUtil);
    }

    @Test
    void sendCodeSuccess() {
        doNothing().when(captchaService).verify(any(), any());
        when(verificationCodeMapper.selectCount(any())).thenReturn(1L, 1L);  // todayCount, ipCount
        when(verificationCodeMapper.selectOne(any())).thenReturn(null);       // 60s check pass
        when(verificationCodeMapper.insert(any())).thenReturn(1);

        authService.sendCode("13800138000", "127.0.0.1", "token", "A3K9");

        verify(smsProvider).send(eq("13800138000"), any());
        verify(verificationCodeMapper).insert(any());
    }

    @Test
    void sendCodePhoneDailyLimit() {
        doNothing().when(captchaService).verify(any(), any());
        when(verificationCodeMapper.selectCount(any())).thenReturn(10L);  // 当日已发10次

        assertThatThrownBy(() ->
                authService.sendCode("13800138000", "127.0.0.1", "token", "A3K9"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("今日发送次数");
    }

    @Test
    void sendCodeRateLimited60s() {
        doNothing().when(captchaService).verify(any(), any());
        when(verificationCodeMapper.selectCount(any())).thenReturn(1L, 1L);
        when(verificationCodeMapper.selectOne(any())).thenReturn(new VerificationCode());  // 60s内有记录

        assertThatThrownBy(() ->
                authService.sendCode("13800138000", "127.0.0.1", "token", "A3K9"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("60秒");
    }

    @Test
    void loginNewUser() {
        // 验证码有效
        VerificationCode vc = new VerificationCode()
                .setId(1L)
                .setPhone("13800138000")
                .setCode("123456")
                .setIsUsed(false);
        when(verificationCodeMapper.selectOne(any())).thenReturn(vc);
        when(verificationCodeMapper.updateById(any())).thenReturn(1);

        // 用户不存在 → 注册
        when(userMapper.selectOne(any())).thenReturn(null);
        when(userMapper.insert(any())).thenReturn(1);
        when(userMapper.selectCount(any())).thenReturn(0L);  // username 不重复

        var resp = authService.login("13800138000", "123456");

        assertThat(resp.getPhone()).isEqualTo("13800138000");
        assertThat(resp.getIsNewUser()).isTrue();
        assertThat(resp.getToken()).isNotBlank();
        verify(userMapper).insert(any(User.class));
    }

    @Test
    void loginExistingUser() {
        VerificationCode vc = new VerificationCode()
                .setId(1L)
                .setPhone("13800138000")
                .setCode("123456")
                .setIsUsed(false);
        when(verificationCodeMapper.selectOne(any())).thenReturn(vc);
        when(verificationCodeMapper.updateById(any())).thenReturn(1);

        User existing = new User()
                .setPhone("13800138000")
                .setUsername("用户7281")
                .setStatus("NORMAL");
        existing.setId(1L);  // BaseEntity setter, 不能链式混用
        when(userMapper.selectOne(any())).thenReturn(existing);

        var resp = authService.login("13800138000", "123456");

        assertThat(resp.getIsNewUser()).isFalse();
        assertThat(resp.getUsername()).isEqualTo("用户7281");
        verify(userMapper, never()).insert(any());
    }

    @Test
    void loginInvalidCode() {
        VerificationCode vc = new VerificationCode()
                .setId(1L)
                .setPhone("13800138000")
                .setCode("999999")
                .setIsUsed(false);
        when(verificationCodeMapper.selectOne(any())).thenReturn(vc);

        assertThatThrownBy(() -> authService.login("13800138000", "123456"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("验证码错误");
    }
}
