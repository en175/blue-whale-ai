package com.blue.whale.agent.service;

import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.model.entity.Project;
import com.blue.whale.global.base.resp.SystemCode;
import com.blue.whale.global.exception.GlobalException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

/**
 * {@link SnapshotService} 单测：归属校验（越权/不存在的错误码不泄漏资源存在性）。
 * 校验通过后的聚合读取逻辑由 H2 集成测试覆盖。
 */
@ExtendWith(MockitoExtension.class)
class SnapshotServiceTest {

    @Mock
    private ProjectService projectService;
    @Mock
    private com.blue.whale.agent.service.CanvasService canvasService;
    @Mock
    private GenerationJobMapper generationJobMapper;
    @Mock
    private AssetMapper assetMapper;
    @Mock
    private ProjectEventService projectEventService;

    @InjectMocks
    private SnapshotService snapshotService;

    @Test
    void getSnapshotRejectsWhenNotOwned() {
        doThrow(new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在"))
                .when(projectService).requireOwned(1L, 999L);

        assertThatThrownBy(() -> snapshotService.getSnapshot(1L, 999L))
                .isInstanceOf(GlobalException.class)
                .extracting(e -> ((GlobalException) e).getCode())
                .isEqualTo(SystemCode.RESOURCE_NOT_FOUND_CODE);
    }

    @Test
    void getSnapshotRejectsWhenNotExist() {
        doThrow(new GlobalException(SystemCode.RESOURCE_NOT_FOUND_CODE, "资源不存在"))
                .when(projectService).requireOwned(99L, 10L);

        assertThatThrownBy(() -> snapshotService.getSnapshot(99L, 10L))
                .isInstanceOf(GlobalException.class)
                .extracting(e -> ((GlobalException) e).getCode())
                .isEqualTo(SystemCode.RESOURCE_NOT_FOUND_CODE);
    }
}
