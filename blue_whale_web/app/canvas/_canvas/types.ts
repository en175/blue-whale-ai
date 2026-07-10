/**
 * types —— _canvas 模块类型兼容层（IJZYVQ ARCH-5）
 *
 * 拆分为两个文件后，本文件保留为 re-export 兼容层，不破坏外部 import path：
 *   - 领域类型（Project / Asset / GenerationJob / NodeItem / Card / ChatMessage ...）
 *     → re-export 自 `@/types/domain`
 *   - UI 层类型（ToolDef / DockMediaItem / *DockContentProps）
 *     → re-export 自 `./uiProps`
 *
 * 拆自原 125 行单文件（IJZYVQ ARCH-5 顶层领域类型聚合），所有类型按职责外置。
 */
export * from "@/types/domain";
export * from "./uiProps";