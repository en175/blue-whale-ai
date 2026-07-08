package com.blue.whale.user.service;

import com.blue.whale.user.entity.User;
import com.blue.whale.user.mapper.UserMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 用户服务
 */
@Service
@RequiredArgsConstructor
public class UserService {

    private final UserMapper userMapper;

    /**
     * 根据 ID 查询用户
     */
    public User getById(Long userId) {
        return userMapper.selectById(userId);
    }
}
