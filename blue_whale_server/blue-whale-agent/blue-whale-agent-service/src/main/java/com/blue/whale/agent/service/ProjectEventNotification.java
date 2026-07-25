package com.blue.whale.agent.service;

/**
 * Project 事件唤醒信号。只携带稳定身份与游标；完整产品事实始终从 project_events 重放。
 */
public record ProjectEventNotification(String messageId, Long projectId, Long cursor) {
}
