package com.blue.whale.user.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
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

        userMapper.update(null,
                new LambdaUpdateWrapper<User>()
                        .eq(User::getId, userId)
                        .set(User::getPhone, newPhone)
                        .set(User::getGmtModified, LocalDateTime.now())
        );
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

        userMapper.update(null,
                new LambdaUpdateWrapper<User>()
                        .eq(User::getId, userId)
                        .set(User::getUsername, username)
                        .set(User::getGmtModified, LocalDateTime.now())
        );
    }
}
