package com.blue.whale.user.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.blue.whale.global.exception.GlobalException;
import com.blue.whale.user.entity.User;
import com.blue.whale.user.mapper.UserMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

/**
 * 用户服务
 */
@Service
@RequiredArgsConstructor
public class UserService {

    private final UserMapper userMapper;

    public User getById(Long userId) {
        return userMapper.selectById(userId);
    }

    /**
     * 更新手机号
     */
    public void updatePhone(Long userId, String newPhone) {
        // 检查新手机号是否已被占用
        Long count = userMapper.selectCount(
                new LambdaQueryWrapper<User>().eq(User::getPhone, newPhone)
        );
        if (count > 0) {
            throw new GlobalException(400, "该手机号已被其他账号绑定");
        }

        User user = userMapper.selectById(userId);
        if (user == null) {
            throw new GlobalException(404, "用户不存在");
        }
        user.setPhone(newPhone);
        user.setGmtModified(LocalDateTime.now());
        userMapper.updateById(user);
    }

    /**
     * 更新用户名
     */
    public void updateUsername(Long userId, String username) {
        Long count = userMapper.selectCount(
                new LambdaQueryWrapper<User>()
                        .eq(User::getUsername, username)
                        .ne(User::getId, userId)
        );
        if (count > 0) {
            throw new GlobalException(400, "该用户名已被占用");
        }

        User user = userMapper.selectById(userId);
        if (user == null) {
            throw new GlobalException(404, "用户不存在");
        }
        user.setUsername(username);
        user.setGmtModified(LocalDateTime.now());
        userMapper.updateById(user);
    }
}
