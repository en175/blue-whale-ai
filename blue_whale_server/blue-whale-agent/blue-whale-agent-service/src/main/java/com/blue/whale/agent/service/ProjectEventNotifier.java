package com.blue.whale.agent.service;

import java.util.function.Consumer;

/** Project 事件跨连接唤醒边界。通知可以重复或丢失，恢复正确性只依赖持久事件日志。 */
public interface ProjectEventNotifier {

    void publish(ProjectEventNotification notification);

    void subscribe(Consumer<ProjectEventNotification> subscriber);
}
