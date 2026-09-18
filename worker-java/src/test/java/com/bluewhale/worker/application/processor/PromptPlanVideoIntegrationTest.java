package com.bluewhale.worker.application.processor;

import com.baomidou.mybatisplus.extension.spring.MybatisSqlSessionFactoryBean;
import com.bluewhale.worker.application.service.AssetSourceService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
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

/** The public API test creates the job and verifies the HTTP provider request and resulting job.
 * This runner drives the real Java processor, mappers and isolated database, without internal mocks.
 */
@EnabledIfEnvironmentVariable(named = "IKETSX_JOB_ID", matches = "[0-9]+")
class PromptPlanVideoIntegrationTest {
    @Configuration
    @EnableTransactionManagement
    @MapperScan("com.bluewhale.worker.infrastructure.mapper")
    @Import({JobStateMachineService.class, AssetSourceService.class})
    static class Database {
        @Bean(destroyMethod = "close")
        HikariDataSource dataSource() {
            var source = new HikariDataSource();
            source.setJdbcUrl(System.getenv("IKETSX_JDBC_URL"));
            source.setUsername("root");
            source.setMaximumPoolSize(3);
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
    }

    @Test
    void executeAcceptedVideoThroughRealPersistenceAndProvider() throws Exception {
        try (var context = new AnnotationConfigApplicationContext(Database.class)) {
            // The external queue is driven synchronously; external object storage is a passthrough.
            var queue = new GenerationMessageProducer() {
                public void enqueue(String jobId, long delayMs) {}
                public void close() {}
            };
            var relay = new TosVideoMediaRelay(null, "", "") {
                @Override public StoredVideo persist(String url, String userId) {
                    return new StoredVideo(url, null, "video/mp4", 100L, "0123456789abcdef0123456789abcdef");
                }
            };
            var processor = new VideoJobProcessor(context.getBean(JobStateMachineService.class),
                    context.getBean(AssetSourceService.class), new GenerationCredentialService(),
                    new NewApiVideoClient(System.getenv("IKETSX_PROVIDER_URL")), relay, queue);
            processor.handle(System.getenv("IKETSX_JOB_ID"));
            Thread.sleep(5500);
            processor.handle(System.getenv("IKETSX_JOB_ID"));
        }
    }
}
