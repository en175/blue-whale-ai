package com.blue.whale.web.spring.listener.functions;


import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.SpringApplicationRunListener;

/**
 * SweetOaSpringListener
 *
 * @author: Jiyeon2__
 * date: 2025/4/1
 * description:
 */
@Getter
@Setter
public class SweetOaSpringListener implements SpringApplicationRunListener {
    private SpringApplication application;
    private String[] args;
}
