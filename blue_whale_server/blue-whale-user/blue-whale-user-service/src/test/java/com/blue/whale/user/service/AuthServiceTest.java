package com.blue.whale.user.service;

import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.tool.redis.utils.RedisUtil;
import com.blue.whale.user.config.JwtConfig;
import com.blue.whale.user.config.JwtUtil;
import com.blue.whale.user.entity.User;
import com.blue.whale.user.mapper.UserMapper;
import com.blue.whale.user.service.impl.AuthServiceImpl;
import com.blue.whale.user.sms.ConsoleSmsProvider;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.MockedStatic;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.security.crypto.password.PasswordEncoder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AuthServiceTest {

    @Mock private UserMapper userMapper;
    @Mock private RedisTemplate<String, Object> redisTemplate;
    @Mock private ValueOperations<String, Object> valueOperations;
    @Mock private PasswordEncoder passwordEncoder;
    private ConsoleSmsProvider smsProvider;

    private AuthServiceImpl authService;
    private MockedStatic<RedisUtil> redisMock;

    @BeforeEach
    void setUp() {
        JwtConfig jwtConfig = new JwtConfig();
        jwtConfig.setSecret("test-secret-key-for-unit-tests-at-least-256-bits!!");
        jwtConfig.setExpiration(604800L);
        JwtUtil jwtUtil = new JwtUtil(jwtConfig);
        smsProvider = spy(new ConsoleSmsProvider());
        authService = new AuthServiceImpl(userMapper, smsProvider, jwtUtil, passwordEncoder);

        redisMock = mockStatic(RedisUtil.class);
        redisMock.when(RedisUtil::getRedisTemplate).thenReturn(redisTemplate);
    }

    @AfterEach
    void tearDown() {
        redisMock.close();
    }

    // ==================== 发验证码 ====================

    @Test
    void sendCodeSuccess() {
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.increment(anyString())).thenReturn(1L);
        redisMock.when(() -> RedisUtil.getCacheObject(contains("60s"))).thenReturn(null);

        authService.sendCode("13800138000", "127.0.0.1");

        verify(smsProvider).send(eq("13800138000"), any());
    }

    @Test
    void sendCodePhoneDailyLimit() {
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.increment(anyString())).thenReturn(11L);

        assertThatThrownBy(() ->
                authService.sendCode("13800138000", "127.0.0.1"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("今日发送次数");
    }

    @Test
    void sendCodeRateLimited60s() {
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.increment(anyString())).thenReturn(1L);
        redisMock.when(() -> RedisUtil.getCacheObject(contains("60s"))).thenReturn("1");

        assertThatThrownBy(() ->
                authService.sendCode("13800138000", "127.0.0.1"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("60秒");
    }

    // ==================== 登录 ====================

    @Test
    void loginNewUser() {
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

    // ==================== 修改密码 ====================

    @Test
    void changePasswordSuccess() {
        User user = userWithPassword("13800138000", "old_hashed");
        when(userMapper.selectById(1L)).thenReturn(user);

        // Redis 限流
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.increment(contains("passwd:change"))).thenReturn(1L);

        // 验证码通过
        redisMock.when(() -> RedisUtil.getCacheObject(contains("code:13800138000")))
                .thenReturn("123456");

        // 旧密码通过
        when(passwordEncoder.matches("old_pass", "old_hashed")).thenReturn(true);
        // 新旧不重复
        when(passwordEncoder.matches("new_pass_1", "old_hashed")).thenReturn(false);
        // 加密
        when(passwordEncoder.encode("new_pass_1")).thenReturn("new_hashed");

        // 模拟 Redis SCAN 返回 refresh_token key（踢设备）
        doAnswer(invocation -> {
            RedisCallback<Void> callback = invocation.getArgument(0);
            RedisConnection conn = mock(RedisConnection.class);
            Cursor<byte[]> cursor = mock(Cursor.class);
            when(cursor.hasNext()).thenReturn(true, false);
            when(cursor.next()).thenReturn("bw:refresh:jti123".getBytes());
            when(conn.scan(any(ScanOptions.class))).thenReturn(cursor);
            callback.doInRedis(conn);
            return null;
        }).when(redisTemplate).execute(any(RedisCallback.class));
        redisMock.when(() -> RedisUtil.getCacheObject("bw:refresh:jti123"))
                .thenReturn("1");

        when(userMapper.updateById(any(User.class))).thenReturn(1);

        authService.changePassword(1L, "123456", "old_pass", "new_pass_1", "127.0.0.1");

        // 验证码已消费
        redisMock.verify(() -> RedisUtil.delete(contains("code:13800138000")));
        // refresh_token 已清除
        redisMock.verify(() -> RedisUtil.delete("bw:refresh:jti123"));
    }

    @Test
    void changePasswordWrongOldPassword() {
        User user = userWithPassword("13800138000", "old_hashed");
        when(userMapper.selectById(1L)).thenReturn(user);

        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.increment(contains("passwd:change"))).thenReturn(1L);

        redisMock.when(() -> RedisUtil.getCacheObject(contains("code:13800138000")))
                .thenReturn("123456");

        when(passwordEncoder.matches("wrong_old", "old_hashed")).thenReturn(false);

        assertThatThrownBy(() ->
                authService.changePassword(1L, "123456", "wrong_old", "new_pass", "127.0.0.1"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("旧密码错误");
    }

    @Test
    void changePasswordWrongCode() {
        User user = userWithPassword("13800138000", "old_hashed");
        when(userMapper.selectById(1L)).thenReturn(user);

        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.increment(contains("passwd:change"))).thenReturn(1L);

        redisMock.when(() -> RedisUtil.getCacheObject(contains("code:13800138000")))
                .thenReturn("999999");

        assertThatThrownBy(() ->
                authService.changePassword(1L, "654321", "old_pass", "new_pass", "127.0.0.1"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("验证码错误");
    }

    @Test
    void changePasswordNoPasswordSet() {
        User user = new User()
                .setPhone("13800138000")
                .setUsername("testuser")
                .setStatus("NORMAL");
        user.setId(1L);
        // password = null → 未设密码
        when(userMapper.selectById(1L)).thenReturn(user);

        assertThatThrownBy(() ->
                authService.changePassword(1L, "123456", "old", "new", "127.0.0.1"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("尚未设置密码");
    }

    @Test
    void changePasswordRateLimited() {
        User user = userWithPassword("13800138000", "old_hashed");
        when(userMapper.selectById(1L)).thenReturn(user);

        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        // 第 4 次 → 超限
        when(valueOperations.increment(contains("passwd:change"))).thenReturn(4L);

        assertThatThrownBy(() ->
                authService.changePassword(1L, "123456", "old_pass", "new_pass", "127.0.0.1"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("操作过于频繁");
    }

    @Test
    void changePasswordWeakNewPassword() {
        User user = userWithPassword("13800138000", "old_hashed");
        when(userMapper.selectById(1L)).thenReturn(user);

        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.increment(contains("passwd:change"))).thenReturn(1L);

        redisMock.when(() -> RedisUtil.getCacheObject(contains("code:13800138000")))
                .thenReturn("123456");

        when(passwordEncoder.matches("old_pass", "old_hashed")).thenReturn(true);

        // 纯数字密码 → 不通过强度校验
        assertThatThrownBy(() ->
                authService.changePassword(1L, "123456", "old_pass", "12345678", "127.0.0.1"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("密码需");
    }

    @Test
    void changePasswordSameAsOld() {
        User user = userWithPassword("13800138000", "old_hashed");
        when(userMapper.selectById(1L)).thenReturn(user);

        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.increment(contains("passwd:change"))).thenReturn(1L);

        redisMock.when(() -> RedisUtil.getCacheObject(contains("code:13800138000")))
                .thenReturn("123456");

        // old_password 也是合法格式的密码
        when(passwordEncoder.matches("SameOld1", "old_hashed")).thenReturn(true);
        // 新旧密码相同（BCrypt matches 同一个密码）→ 拒绝
        when(passwordEncoder.matches("SameOld1", "old_hashed")).thenReturn(true);

        assertThatThrownBy(() ->
                authService.changePassword(1L, "123456", "SameOld1", "SameOld1", "127.0.0.1"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("新密码不能与旧密码相同");
    }

    // ==================== 工具方法 ====================

    private static User userWithPassword(String phone, String hashedPassword) {
        User user = new User()
                .setPhone(phone)
                .setUsername("testuser")
                .setPassword(hashedPassword)
                .setStatus("NORMAL");
        user.setId(1L);
        return user;
    }
}
