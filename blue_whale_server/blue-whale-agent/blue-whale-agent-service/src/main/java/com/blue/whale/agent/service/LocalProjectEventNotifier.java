package com.blue.whale.agent.service;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

/** 本地开发兜底通知器；SSE 仍通过数据库重放和心跳追平，不把本对象当作事实存储。 */
public class LocalProjectEventNotifier implements ProjectEventNotifier {

    private final List<Consumer<ProjectEventNotification>> subscribers = new CopyOnWriteArrayList<>();

    @Override
    public void publish(ProjectEventNotification notification) {
        subscribers.forEach(subscriber -> subscriber.accept(notification));
    }

    @Override
    public void subscribe(Consumer<ProjectEventNotification> subscriber) {
        subscribers.add(subscriber);
    }
}
