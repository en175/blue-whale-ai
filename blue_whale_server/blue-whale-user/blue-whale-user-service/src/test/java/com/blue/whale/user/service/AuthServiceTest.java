package com.blue.whale.user.service;

import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.tool.redis.utils.RedisUtil;
import com.blue.whale.user.config.JwtConfig;
import com.blue.whale.user.config.JwtUtil;
import com.blue.whale.user.entity.User;
import com.blue.whale.user.mapper.UserMapper;
import com.blue.whale.user.sms.ConsoleSmsProvider;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.MockedStatic;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

    @Mock private UserMapper userMapper;
    @Mock private CaptchaService captchaService;
    @Mock private RedisTemplate<String, Object> redisTemplate;
    @Mock private ValueOperations<String, Object> valueOperations;
    private ConsoleSmsProvider smsProvider;

    private AuthService authService;
    private MockedStatic<RedisUtil> redisMock;

    @BeforeEach
    void setUp() {
        JwtConfig jwtConfig = new JwtConfig();
        jwtConfig.setSecret("test-secret-key-for-unit-tests-at-least-256-bits!!");
        jwtConfig.setExpiration(604800L);
        JwtUtil jwtUtil = new JwtUtil(jwtConfig);
        smsProvider = spy(new ConsoleSmsProvider());
        authService = new AuthService(userMapper, captchaService, smsProvider, jwtUtil);

        redisMock = mockStatic(RedisUtil.class);
    }

    @AfterEach
    void tearDown() {
        redisMock.close();
    }

    @Test
    void sendCodeSuccess() {
        doNothing().when(captchaService).verify(any(), any());

        // mock RedisTemplate（供 incrWithTTL 使用）
        redisMock.when(RedisUtil::getRedisTemplate).thenReturn(redisTemplate);
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.increment(anyString())).thenReturn(1L);  // 首次计数

        // 模拟 Redis: 60s间隔无记录
        redisMock.when(() -> RedisUtil.getCacheObject(contains("60s"))).thenReturn(null);

        authService.sendCode("13800138000", "127.0.0.1", "token", "A3K9");

        verify(smsProvider).send(eq("13800138000"), any());
    }

    @Test
    void sendCodePhoneDailyLimit() {
        doNothing().when(captchaService).verify(any(), any());

        redisMock.when(RedisUtil::getRedisTemplate).thenReturn(redisTemplate);
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.increment(anyString())).thenReturn(11L);  // 超过日限

        assertThatThrownBy(() ->
                authService.sendCode("13800138000", "127.0.0.1", "token", "A3K9"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("今日发送次数");
    }

    @Test
    void sendCodeRateLimited60s() {
        doNothing().when(captchaService).verify(any(), any());

        redisMock.when(RedisUtil::getRedisTemplate).thenReturn(redisTemplate);
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.increment(anyString())).thenReturn(1L);

        redisMock.when(() -> RedisUtil.getCacheObject(contains("60s"))).thenReturn("1");

        assertThatThrownBy(() ->
                authService.sendCode("13800138000", "127.0.0.1", "token", "A3K9"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("60秒");
    }

    @Test
    void loginNewUser() {
        // Redis 返回正确验证码
        redisMock.when(() -> RedisUtil.getCacheObject(contains("code"))).thenReturn("123456");

        when(userMapper.selectOne(any())).thenReturn(null);
        when(userMapper.insert(any())).thenReturn(1);
        when(userMapper.selectCount(any())).thenReturn(0L);

        var resp = authService.login("13800138000", "123456");

        assertThat(resp.getPhone()).isEqualTo("13800138000");
        assertThat(resp.getIsNewUser()).isTrue();
        assertThat(resp.getAccessToken()).isNotBlank();
        assertThat(resp.getRefreshToken()).isNotBlank();
        verify(userMapper).insert(any(User.class));
    }

    @Test
    void loginExistingUser() {
        redisMock.when(() -> RedisUtil.getCacheObject(contains("code"))).thenReturn("123456");

        User existing = new User()
                .setPhone("13800138000")
                .setUsername("用户7281")
                .setStatus("NORMAL");
        existing.setId(1L);
        when(userMapper.selectOne(any())).thenReturn(existing);

        var resp = authService.login("13800138000", "123456");

        assertThat(resp.getIsNewUser()).isFalse();
        assertThat(resp.getUsername()).isEqualTo("用户7281");
        verify(userMapper, never()).insert(any());
    }

    @Test
    void loginInvalidCode() {
        redisMock.when(() -> RedisUtil.getCacheObject(contains("code"))).thenReturn("999999");

        assertThatThrownBy(() -> authService.login("13800138000", "123456"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("验证码错误");
    }
}
