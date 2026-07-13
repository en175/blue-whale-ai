package com.blue.whale.web.spring.listener;

import cn.hutool.core.collection.CollUtil;
import com.blue.whale.web.spring.listener.functions.SweetOaSpringListener;
import org.springframework.boot.ConfigurableBootstrapContext;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.SpringApplicationRunListener;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.ConfigurableEnvironment;

import java.time.Duration;
import java.util.ServiceLoader;

/**
 * GruulAutoConfigureSpringListener
 *
 * @author: Jiyeon2__
 * date: 2024/8/15
 * description:
 */
public class SweetOaAutoConfigureSpringListener implements SpringApplicationRunListener {

    private final ServiceLoader<SweetOaSpringListener> listeners;

    public SweetOaAutoConfigureSpringListener(SpringApplication application, String[] args) {
        listeners = ServiceLoader.load(SweetOaSpringListener.class);
        this.setArgs(application, args);
    }

    @Override
    public void starting(ConfigurableBootstrapContext bootstrapContext) {
        listeners.forEach(listener -> listener.starting(bootstrapContext));
    }

    @Override
    public void environmentPrepared(ConfigurableBootstrapContext bootstrapContext, ConfigurableEnvironment environment) {
        listeners.forEach(listener -> listener.environmentPrepared(bootstrapContext, environment));
    }

    @Override
    public void contextPrepared(ConfigurableApplicationContext context) {
        listeners.forEach(listener -> listener.contextPrepared(context));
    }

    @Override
    public void contextLoaded(ConfigurableApplicationContext context) {
        listeners.forEach(listener -> listener.contextLoaded(context));
    }

    @Override
    public void started(ConfigurableApplicationContext context, Duration timeTaken) {
        listeners.forEach(listener -> listener.started(context,timeTaken));
    }

    @Override
    public void ready(ConfigurableApplicationContext context, Duration timeTaken) {
        listeners.forEach(listener -> listener.ready(context,timeTaken));
    }

    @Override
    public void failed(ConfigurableApplicationContext context, Throwable exception) {
        listeners.forEach(listener -> listener.failed(context,exception));
    }

    private void setArgs(SpringApplication application, String[] args) {
        if (CollUtil.isEmpty(listeners)) {
            return;
        }
        listeners.forEach(
                listener->{
                    listener.setApplication(application);
                    listener.setArgs(args);
                }
        );
    }
}
