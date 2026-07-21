package com.blue.whale.user.service;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.tool.redis.utils.RedisUtil;
import com.blue.whale.user.config.JwtConfig;
import com.blue.whale.user.config.JwtUtil;
import com.blue.whale.user.entity.User;
import com.blue.whale.user.mapper.UserMapper;
import com.blue.whale.user.sms.ConsoleSmsProvider;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.MockedStatic;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.SetOperations;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AuthServiceTest {

    @Mock private UserMapper userMapper;
    @Mock private CaptchaService captchaService;
    @Mock private RedisTemplate<String, Object> redisTemplate;
    @Mock private ValueOperations<String, Object> valueOperations;
    @Mock private SetOperations<String, Object> setOperations;
    @Mock private PasswordEncoder passwordEncoder;
    private ConsoleSmsProvider smsProvider;

    private AuthService authService;
    private MockedStatic<RedisUtil> redisMock;

    @BeforeAll
    static void initLambdaCache() {
        // MyBatis-Plus lambda cache 在纯单元测试中未初始化，手动建 User 的 TableInfo
        TableInfoHelper.initTableInfo(
                new MapperBuilderAssistant(new MybatisConfiguration(), ""),
                User.class);
    }

    @BeforeEach
    void setUp() {
        smsProvider = spy(new ConsoleSmsProvider());
        authService = new AuthService(userMapper, captchaService, smsProvider, makeJwtUtil(), passwordEncoder);

        redisMock = mockStatic(RedisUtil.class);
        redisMock.when(RedisUtil::getRedisTemplate).thenReturn(redisTemplate);
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(redisTemplate.opsForSet()).thenReturn(setOperations);
    }

    @AfterEach
    void tearDown() {
        redisMock.close();
    }

    // ==================== 发验证码 ====================

    @Test
    void sendCodeSuccess() {
        doNothing().when(captchaService).verify(any(), any());

        when(valueOperations.increment(anyString())).thenReturn(1L);
        redisMock.when(() -> RedisUtil.getCacheObject(contains("60s"))).thenReturn(null);

        authService.sendCode("13800138000", "127.0.0.1", "token", "A3K9");

        verify(smsProvider).send(eq("13800138000"), any());
    }

    @Test
    void sendCodePhoneDailyLimit() {
        doNothing().when(captchaService).verify(any(), any());
        when(valueOperations.increment(anyString())).thenReturn(11L);

        assertThatThrownBy(() ->
                authService.sendCode("13800138000", "127.0.0.1", "token", "A3K9"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("今日发送次数");
    }

    @Test
    void sendCodeRateLimited60s() {
        doNothing().when(captchaService).verify(any(), any());
        when(valueOperations.increment(anyString())).thenReturn(1L);
        redisMock.when(() -> RedisUtil.getCacheObject(contains("60s"))).thenReturn("1");

        assertThatThrownBy(() ->
                authService.sendCode("13800138000", "127.0.0.1", "token", "A3K9"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("60秒");
    }

    // ==================== 登录 ====================

    @Test
    void loginNewUser() {
        redisMock.when(() -> RedisUtil.getCacheObject(contains("code"))).thenReturn("123456");
        when(userMapper.selectOne(any())).thenReturn(null);
        when(userMapper.insert(any(User.class))).thenReturn(1);
        when(userMapper.selectCount(any())).thenReturn(0L);

        var resp = authService.login("13800138000", "123456");

        org.assertj.core.api.Assertions.assertThat(resp.getIsNewUser()).isTrue();
        org.assertj.core.api.Assertions.assertThat(resp.getAccessToken()).isNotBlank();
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

        org.assertj.core.api.Assertions.assertThat(resp.getIsNewUser()).isFalse();
        verify(userMapper, never()).insert(any(User.class));
    }

    @Test
    void loginInvalidCode() {
        redisMock.when(() -> RedisUtil.getCacheObject(contains("code"))).thenReturn("999999");

        assertThatThrownBy(() -> authService.login("13800138000", "123456"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("验证码错误");
    }

    // ==================== 反向索引（踢设备） ====================

    @Test
    void loginWritesUserIndex() {
        redisMock.when(() -> RedisUtil.getCacheObject(contains("code"))).thenReturn("123456");
        User existing = new User().setPhone("13800138000").setUsername("u").setStatus("NORMAL");
        existing.setId(42L);
        when(userMapper.selectOne(any())).thenReturn(existing);

        authService.login("13800138000", "123456");

        verify(setOperations).add(eq("bw:refresh:user:42"), anyString());
    }

    @Test
    void refreshReplacesUserIndex() {
        JwtUtil jwtUtil = makeJwtUtil();
        String refreshToken = jwtUtil.generateRefreshToken("42");
        String oldJti = jwtUtil.parse(refreshToken).getId();

        redisMock.when(() -> RedisUtil.getCacheObject(eq("bw:refresh:" + oldJti))).thenReturn("42");
        User user = new User().setPhone("13800138000").setUsername("u").setStatus("NORMAL");
        user.setId(42L);
        when(userMapper.selectById(42L)).thenReturn(user);

        authService.refresh(refreshToken);

        verify(setOperations).remove(eq("bw:refresh:user:42"), eq(oldJti));
        verify(setOperations).add(eq("bw:refresh:user:42"), anyString());
    }

    @Test
    void logoutRemovesUserIndex() {
        JwtUtil jwtUtil = makeJwtUtil();
        String refreshToken = jwtUtil.generateRefreshToken("42");
        String jti = jwtUtil.parse(refreshToken).getId();

        authService.logout(refreshToken);

        verify(setOperations).remove(eq("bw:refresh:user:42"), eq(jti));
    }

    // ==================== 设置密码 ====================

    @Test
    void setPasswordSuccess() {
        User user = new User().setPhone("13800138000").setUsername("u").setStatus("NORMAL");
        user.setId(1L);
        when(userMapper.selectById(1L)).thenReturn(user);
        redisMock.when(() -> RedisUtil.getCacheObject(contains("code:13800138000"))).thenReturn("123456");
        when(passwordEncoder.encode("new_pass_1")).thenReturn("new_hashed");
        when(userMapper.update(any(), any())).thenReturn(1);

        authService.setPassword(1L, "123456", "new_pass_1");

        redisMock.verify(() -> RedisUtil.delete(contains("code:13800138000")));
        verify(userMapper).update(any(), any());
    }

    @Test
    void setPasswordAlreadySet() {
        when(userMapper.selectById(1L)).thenReturn(userWithPassword("13800138000", "old_hashed"));

        assertThatThrownBy(() -> authService.setPassword(1L, "123456", "new_pass_1"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("已设置密码");
    }

    @Test
    void setPasswordWrongCode() {
        User user = new User().setPhone("13800138000").setUsername("u").setStatus("NORMAL");
        user.setId(1L);
        when(userMapper.selectById(1L)).thenReturn(user);
        redisMock.when(() -> RedisUtil.getCacheObject(contains("code:13800138000"))).thenReturn("999999");

        assertThatThrownBy(() -> authService.setPassword(1L, "123456", "new_pass_1"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("验证码错误");
    }

    @Test
    void setPasswordCodeExpired() {
        User user = new User().setPhone("13800138000").setUsername("u").setStatus("NORMAL");
        user.setId(1L);
        when(userMapper.selectById(1L)).thenReturn(user);
        redisMock.when(() -> RedisUtil.getCacheObject(contains("code:13800138000"))).thenReturn(null);

        assertThatThrownBy(() -> authService.setPassword(1L, "123456", "new_pass_1"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("验证码已过期");
    }

    @Test
    void setPasswordWeakPassword() {
        User user = new User().setPhone("13800138000").setUsername("u").setStatus("NORMAL");
        user.setId(1L);
        when(userMapper.selectById(1L)).thenReturn(user);
        redisMock.when(() -> RedisUtil.getCacheObject(contains("code:13800138000"))).thenReturn("123456");

        // 纯数字密码 → 不通过强度校验
        assertThatThrownBy(() -> authService.setPassword(1L, "123456", "12345678"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("密码需");
    }

    @Test
    void setPasswordTestPhoneSkip() {
        User user = new User().setPhone("15079999999").setUsername("u").setStatus("NORMAL");
        user.setId(1L);
        when(userMapper.selectById(1L)).thenReturn(user);
        when(passwordEncoder.encode("new_pass_1")).thenReturn("new_hashed");
        when(userMapper.update(any(), any())).thenReturn(1);

        // 测试号跳过验证码：不 stub getCacheObject，若被调用会返回 null 抛「已过期」
        authService.setPassword(1L, "any", "new_pass_1");

        redisMock.verify(() -> RedisUtil.getCacheObject(contains("code")), never());
        verify(userMapper).update(any(), any());
    }

    @Test
    void setPasswordUserNotFound() {
        when(userMapper.selectById(1L)).thenReturn(null);

        assertThatThrownBy(() -> authService.setPassword(1L, "123456", "new_pass_1"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("用户不存在");
    }

    // ==================== 修改密码 ====================

    @Test
    void changePasswordSuccess() {
        User user = userWithPassword("13800138000", "old_hashed");
        when(userMapper.selectById(1L)).thenReturn(user);
        when(valueOperations.increment(contains("passwd:change"))).thenReturn(1L);
        redisMock.when(() -> RedisUtil.getCacheObject(contains("code:13800138000"))).thenReturn("123456");
        when(passwordEncoder.matches("old_pass", "old_hashed")).thenReturn(true);
        when(passwordEncoder.matches("new_pass_1", "old_hashed")).thenReturn(false);
        when(passwordEncoder.encode("new_pass_1")).thenReturn("new_hashed");
        when(userMapper.update(any(), any())).thenReturn(1);

        // 反向索引踢设备：getCacheSet 返回 jti 集合
        redisMock.when(() -> RedisUtil.getCacheSet("bw:refresh:user:1"))
                .thenReturn(Set.of("jti1", "jti2"));

        authService.changePassword(1L, "123456", "old_pass", "new_pass_1");

        redisMock.verify(() -> RedisUtil.delete(contains("code:13800138000")));
        // 踢设备：删除该用户所有 refresh_token + 反向索引
        redisMock.verify(() -> RedisUtil.delete("bw:refresh:jti1"));
        redisMock.verify(() -> RedisUtil.delete("bw:refresh:jti2"));
        redisMock.verify(() -> RedisUtil.delete("bw:refresh:user:1"));
    }

    @Test
    void changePasswordWrongOldPassword() {
        when(userMapper.selectById(1L)).thenReturn(userWithPassword("13800138000", "old_hashed"));
        when(valueOperations.increment(contains("passwd:change"))).thenReturn(1L);
        redisMock.when(() -> RedisUtil.getCacheObject(contains("code:13800138000"))).thenReturn("123456");
        when(passwordEncoder.matches("wrong_old", "old_hashed")).thenReturn(false);

        assertThatThrownBy(() ->
                authService.changePassword(1L, "123456", "wrong_old", "new_pass_1"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("旧密码错误");
    }

    @Test
    void changePasswordWrongCode() {
        when(userMapper.selectById(1L)).thenReturn(userWithPassword("13800138000", "old_hashed"));
        when(valueOperations.increment(contains("passwd:change"))).thenReturn(1L);
        redisMock.when(() -> RedisUtil.getCacheObject(contains("code:13800138000"))).thenReturn("999999");

        assertThatThrownBy(() ->
                authService.changePassword(1L, "654321", "old_pass", "new_pass_1"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("验证码错误");
    }

    @Test
    void changePasswordNoPasswordSet() {
        User user = new User().setPhone("13800138000").setUsername("u").setStatus("NORMAL");
        user.setId(1L);
        when(userMapper.selectById(1L)).thenReturn(user);

        assertThatThrownBy(() ->
                authService.changePassword(1L, "123456", "old", "new_pass_1"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("尚未设置密码");
    }

    @Test
    void changePasswordRateLimited() {
        when(userMapper.selectById(1L)).thenReturn(userWithPassword("13800138000", "old_hashed"));
        when(valueOperations.increment(contains("passwd:change"))).thenReturn(4L);

        assertThatThrownBy(() ->
                authService.changePassword(1L, "123456", "old_pass", "new_pass_1"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("操作过于频繁");
    }

    @Test
    void changePasswordWeakNewPassword() {
        when(userMapper.selectById(1L)).thenReturn(userWithPassword("13800138000", "old_hashed"));
        when(valueOperations.increment(contains("passwd:change"))).thenReturn(1L);
        redisMock.when(() -> RedisUtil.getCacheObject(contains("code:13800138000"))).thenReturn("123456");
        when(passwordEncoder.matches("old_pass", "old_hashed")).thenReturn(true);

        // 纯数字新密码 → 不通过强度校验
        assertThatThrownBy(() ->
                authService.changePassword(1L, "123456", "old_pass", "12345678"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("密码需");
    }

    @Test
    void changePasswordSameAsOld() {
        when(userMapper.selectById(1L)).thenReturn(userWithPassword("13800138000", "old_hashed"));
        when(valueOperations.increment(contains("passwd:change"))).thenReturn(1L);
        redisMock.when(() -> RedisUtil.getCacheObject(contains("code:13800138000"))).thenReturn("123456");
        // 旧密码正确，且新旧相同（matches 同一密码）
        when(passwordEncoder.matches("SameOld1", "old_hashed")).thenReturn(true);

        assertThatThrownBy(() ->
                authService.changePassword(1L, "123456", "SameOld1", "SameOld1"))
                .isInstanceOf(GlobalException.class)
                .hasMessageContaining("新密码不能与旧密码相同");
    }

    // ==================== 工具方法 ====================

    private JwtUtil makeJwtUtil() {
        JwtConfig jwtConfig = new JwtConfig();
        jwtConfig.setSecret("test-secret-key-for-unit-tests-at-least-256-bits!!");
        jwtConfig.setExpiration(604800L);
        return new JwtUtil(jwtConfig);
    }

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
