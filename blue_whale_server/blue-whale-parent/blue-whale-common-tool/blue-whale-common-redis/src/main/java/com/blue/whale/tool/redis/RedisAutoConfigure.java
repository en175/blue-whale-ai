package com.blue.whale.tool.redis;

import com.blue.whale.tool.redis.aspect.RedissonAdvisor;
import com.blue.whale.tool.redis.aspect.RedissonInterceptor;
import com.blue.whale.tool.redis.config.RedisConfig;
import com.blue.whale.tool.redis.properties.CommonRedisProperties;
import com.blue.whale.tool.redis.utils.RedisUtil;
import com.blue.whale.tool.redis.utils.SpringElUtil;
import org.redisson.api.RedissonClient;
import org.springframework.beans.BeansException;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.ApplicationContext;
import org.springframework.context.ApplicationContextAware;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.data.redis.serializer.StringRedisSerializer;
import org.springframework.lang.NonNull;


/**
 * @author 张治保
 * date 2022/2/16
 */
@Import({RedisConfig.class, RedissonAdvisor.class, RedissonInterceptor.class})
@EnableConfigurationProperties(CommonRedisProperties.class)
@ConditionalOnClass(name = {"org.springframework.data.redis.core.RedisTemplate", "org.springframework.data.redis.connection.RedisConnectionFactory"})
public class RedisAutoConfigure implements InitializingBean, ApplicationContextAware {
	@Value("${spring.application.name}")
	private String applicationName;

	/**
	 * 配置RedisListener
	 */
	@Bean
	@ConditionalOnProperty(prefix = "sweet.oa.redis", name = "enable-message-listener", havingValue = "true")
	@ConditionalOnClass(name = "org.springframework.data.redis.listener.RedisMessageListenerContainer")
	public RedisMessageListenerContainer container(RedisConnectionFactory connectionFactory) {
		RedisMessageListenerContainer container = new RedisMessageListenerContainer();
		container.setConnectionFactory(connectionFactory);
		return container;
	}

	@Primary
	@Bean("sweetOaRedisTemplate")
	public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory factory, RedissonClient redissonClient) {
		RedisTemplate<String, Object> template = new RedisTemplate<>();
		template.setConnectionFactory(factory);
		StringRedisSerializer keySerializer = new StringRedisSerializer();
		template.setKeySerializer(keySerializer);
		template.setHashKeySerializer(keySerializer);

		template.setValueSerializer(RedisUtil.valueSerializer());
		template.setHashValueSerializer(RedisUtil.valueSerializer());
		RedisUtil.setRedisClient(template, redissonClient);
		return template;
	}


	@Override
	public void setApplicationContext(@NonNull ApplicationContext applicationContext) throws BeansException {
		SpringElUtil.setApplicationContext(applicationContext);
	}

	@Override
	public void afterPropertiesSet() {
		RedisUtil.setApplicationName(applicationName);
	}
}
