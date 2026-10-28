package com.bluewhale.worker.application.processor;

import com.baomidou.mybatisplus.extension.spring.MybatisSqlSessionFactoryBean;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamBaseUrl;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobFinalizer;
import com.bluewhale.worker.application.service.TerminalEventOutbox;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.application.service.SceneCardGenerationRecordSync;
import com.bluewhale.worker.application.service.StoryboardPreviewSync;
import com.bluewhale.worker.infrastructure.config.NewApiUpstreamConfig.UpstreamCredential;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.persistence.mapper.AssetMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobLogMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobExtraMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.GenerationOutputSlotMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.SceneCardGenerationRecordMapper;
import com.bluewhale.worker.infrastructure.persistence.mapper.StoryboardPreviewMapper;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;
import com.zaxxer.hikari.HikariDataSource;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;

import javax.sql.DataSource;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@EnabledIfEnvironmentVariable(named = "IKETSX_JOB_ID", matches = "[0-9]+")
class PromptPlanVideoIntegrationTest {
    @Configuration
    @EnableTransactionManagement
    @MapperScan("com.bluewhale.worker.infrastructure.persistence.mapper")
    @Import({JobStateMachineService.class, AssetSourceService.class})
    static class Database {
        @Bean(destroyMethod = "close")
        HikariDataSource dataSource() {
            var source = new HikariDataSource();
            source.setJdbcUrl(System.getenv("IKETSX_JDBC_URL"));
            source.setUsername("root");
            source.setMaximumPoolSize(3);
            source.addDataSourceProperty("connectionTimeZone", "Asia/Shanghai");
            source.addDataSourceProperty("forceConnectionTimeZoneToSession", "true");
            return source;
        }
        @Bean
        SqlSessionFactory sqlSessionFactory(DataSource source) throws Exception {
            var factory = new MybatisSqlSessionFactoryBean();
            factory.setDataSource(source);
            return factory.getObject();
        }
        @Bean
        DataSourceTransactionManager transactionManager(DataSource source) {
            return new DataSourceTransactionManager(source);
        }

        @Bean
        JobFinalizer finalizer(
                GenerationJobMapper jm, AssetMapper am, GenerationJobLogMapper jlm,
                GenerationOutputSlotMapper sm, GenerationJobExtraMapper em,
                SceneCardGenerationRecordMapper rm, StoryboardPreviewMapper pm) {
            return new JobFinalizer(jm, am, jlm, sm, em,
                    new SceneCardGenerationRecordSync(sm, rm),
                    new StoryboardPreviewSync(sm, pm),
                    TerminalEventOutbox.noop());
        }
    }

    @Test
    void executeAcceptedVideoThroughRealPersistenceAndProvider() throws Exception {
        try (var context = new AnnotationConfigApplicationContext(Database.class)) {
            var queue = new GenerationMessageProducer() {
                public void enqueue(String jobId, long delayMs) {}
                public void close() {}
            };
            var relay = new TosVideoMediaRelay(null, "", "") {
                @Override public StoredVideo persist(String url, String userId) {
                    return new StoredVideo(url, null, "video/mp4", 100L, "0123456789abcdef0123456789abcdef");
                }
            };
            UpstreamCredential upstreamCredential = mock(UpstreamCredential.class);
            when(upstreamCredential.requireKey()).thenReturn("sk-integration-token");
            var processor = new VideoJobProcessor(context.getBean(JobStateMachineService.class),
                    context.getBean(JobFinalizer.class),
                    context.getBean(AssetSourceService.class), upstreamCredential,
                    new NewApiVideoClient(new UpstreamBaseUrl(System.getenv("IKETSX_PROVIDER_URL"))), relay, queue);
            processor.handle(System.getenv("IKETSX_JOB_ID"));
            Thread.sleep(5500);
            processor.handle(System.getenv("IKETSX_JOB_ID"));
        }
    }
}
