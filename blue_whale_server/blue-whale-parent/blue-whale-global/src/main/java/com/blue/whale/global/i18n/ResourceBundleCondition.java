package com.blue.whale.global.i18n;

import org.springframework.boot.autoconfigure.condition.ConditionMessage;
import org.springframework.boot.autoconfigure.condition.ConditionOutcome;
import org.springframework.boot.autoconfigure.condition.SpringBootCondition;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.core.type.AnnotatedTypeMetadata;
import org.springframework.util.ConcurrentReferenceHashMap;
import org.springframework.util.StringUtils;

/**
 *
 */
public class ResourceBundleCondition extends SpringBootCondition {

	private static final Resource[] NO_RESOURCES = {};
	private static final ConcurrentReferenceHashMap<String, ConditionOutcome> cache = new ConcurrentReferenceHashMap<>();

	@Override
	public ConditionOutcome getMatchOutcome(ConditionContext context, AnnotatedTypeMetadata metadata) {
		String basename = context.getEnvironment().getProperty("spring.messages.basename", "messages");
		ConditionOutcome outcome = cache.get(basename);
		if (outcome == null) {
			outcome = getMatchOutcomeForBasename(context, basename);
			cache.put(basename, outcome);
		}
		return outcome;
	}

	private ConditionOutcome getMatchOutcomeForBasename(ConditionContext context, String basename) {
		ConditionMessage.Builder message = ConditionMessage.forCondition("ResourceBundle");
		for (String name : StringUtils.commaDelimitedListToStringArray(StringUtils.trimAllWhitespace(basename))) {
			for (Resource resource : getResources(context.getClassLoader(), name)) {
				if (resource.exists()) {
					return ConditionOutcome.match(message.found("bundle").items(resource));
				}
			}
		}
		return ConditionOutcome.noMatch(message.didNotFind("bundle with basename " + basename).atAll());
	}

	private Resource[] getResources(ClassLoader classLoader, String name) {
		String target = name.replace('.', '/');
		try {
			return new PathMatchingResourcePatternResolver(classLoader)
					.getResources("classpath*:" + target + ".properties");
		} catch (Exception ex) {
			return NO_RESOURCES;
		}
	}

}