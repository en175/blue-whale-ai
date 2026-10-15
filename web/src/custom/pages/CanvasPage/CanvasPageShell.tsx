import type { ComponentProps, Dispatch, ReactNode, RefObject, SetStateAction } from 'react';
import type { Node } from '@xyflow/react';
import { createCanvasToolSessions } from './canvasToolSessions';
import type { CanvasHistoryApi } from './hooks/useCanvasHistory';
import type { PickChannel as CanvasPickChannel } from './hooks/useCanvasPickers';
import type { VideoRefRole } from './videoMediaRefs';
import type { AssetsPickerTarget } from './assetsPickerTargets';
import type { VideoGenSeedParams } from './components/BottomDialog';
import type { MediaNodeData } from './components/MediaNode';
import type { UploadedFile } from './components/ImageDialog';
import type { AssetCardKind, AssetCardNodeData } from './components/AssetCardNode';
import CanvasHeader from './components/CanvasHeader';
import CanvasToast, { type ToastState } from './components/CanvasToast';
import CanvasToolbar from './components/CanvasToolbar';
import CanvasBottomLeftActions from './components/CanvasBottomLeftActions';
import CanvasPickHint from './components/CanvasPickHint';
import CanvasPaneContextMenu from './components/CanvasPaneContextMenu';
import ConnectTypeMenu from './components/ConnectTypeMenu';
import AgentPanel from './components/AgentPanel';
import AssetsPickerModal from './components/AssetsPickerModal';
import SharedAssetsModal from './components/SharedAssetsModal';
import CharacterLibraryModal from './components/CharacterLibraryModal';
import LegacyHistoryModal from './components/LegacyHistoryModal';
import AssetDetailModal from '@/custom/pages/Assets/components/AssetDetailModal';
import ConfirmModal from '@/custom/components/ConfirmModal';
import FlowCanvas from './components/Canvas';
import NodeFollowToolbar from './components/NodeFollowToolbar';
import MediaNodeToolbar from './components/MediaNode/Toolbar';
import AssetCardToolbar from './components/AssetCardNode/Toolbar';
import { AssetImageRefLimitProvider } from './modelCaps';
import { assetCardToolbarVisible } from './components/AssetCardNode/toolbarVisibility';
import { availableGenKinds } from './connectAbility';
import { assetsPickerMediaTypes } from './assetsPickerTargets';
import { isFileRejected } from '@/custom/utils/fileSignature';
import pageStyles from './index.module.css';

const ASSET_TOOLBAR_LIFT = 42;
const EMPTY_NODES: Node[] = [];

type ToolbarProps = ComponentProps<typeof CanvasToolbar>;
type BottomProps = ComponentProps<typeof CanvasBottomLeftActions>;
type PickHintProps = ComponentProps<typeof CanvasPickHint>;
type PaneMenuProps = ComponentProps<typeof CanvasPaneContextMenu>;
type HeaderProps = ComponentProps<typeof CanvasHeader>;
type AgentProps = ComponentProps<typeof AgentPanel>;
type SharedProps = ComponentProps<typeof SharedAssetsModal>;
type CharProps = ComponentProps<typeof CharacterLibraryModal>;
type LegacyProps = ComponentProps<typeof LegacyHistoryModal>;
type AssetDetailProps = ComponentProps<typeof AssetDetailModal>;
type ConfirmProps = ComponentProps<typeof ConfirmModal>;
type FlowProps = ComponentProps<typeof FlowCanvas>;
type PickerProps = ComponentProps<typeof AssetsPickerModal>;
type ConnectMenuProps = ComponentProps<typeof ConnectTypeMenu>;

interface CanvasPageShellProps {
  shellTop: {
    applying: boolean;
    assetImageRefMax: number | undefined;
    canvasWrapperRef: RefObject<HTMLDivElement | null>;
    currentId: string | null;
    handleCopySelectedNodes: FlowProps['onCopySelected'];
    handlePasteClipboard: FlowProps['onPasteClipboard'];
    toast: ToastState | null;
    toolSessions: ReturnType<typeof createCanvasToolSessions>;
    navigate: (to: string) => void;
    generationDock: { render: () => ReactNode; renderedToolKinds: ReadonlySet<string> };
  };

  canvas: {
    showMiniMap: FlowProps['showMiniMap'];
    setShowMiniMap: Dispatch<SetStateAction<boolean>>;
    toolMode: FlowProps['toolMode'];
    setToolMode: ToolbarProps['onModeChange'];
    textNodes: FlowProps['textNodes'];
    mediaNodes: FlowProps['mediaNodes'];
    productNodes: FlowProps['productNodes'];
    assetNodes: FlowProps['assetNodes'];
    showEdges: FlowProps['showEdges'];
    setShowEdges: Dispatch<SetStateAction<boolean>>;
    snapAlignmentOn: FlowProps['snapAlignmentEnabled'];
    setSnapAlignmentOn: Dispatch<SetStateAction<boolean>>;
    edges: FlowProps['edges'];
    guardEdgesChange: FlowProps['onEdgesChange'];
    onConnect: FlowProps['onConnect'];
    connectingSourceRef: RefObject<string | null>;
    handleConnectEnd: FlowProps['onConnectEnd'];
    isValidCanvasConnection: FlowProps['isValidConnection'];
    focusViewport: FlowProps['viewport'];
    docViewport: FlowProps['viewport'];
    setViewport: FlowProps['onViewportChange'];
    setLiveViewport: FlowProps['onViewportLive'];
    registerSpawnPosition: FlowProps['registerSpawnPosition'];
    handleNodeDragStop: FlowProps['onNodeDragStop'];
    handleCanvasNodeClick: FlowProps['onNodeClick'];
    handleCanvasPaneClick: FlowProps['onPaneClick'];
    handleSelectionChangeStable: FlowProps['onSelectionChange'];
    refPickActive: boolean | undefined;
    refPickMarkedIds: string[];
    refPickBlockedIds: string[] | undefined;
    selectRequest: FlowProps['selectRequest'];
    selectManyRequest: FlowProps['selectManyRequest'];
    productPickResult: FlowProps['productPickResult'];
    assetPickResult: FlowProps['assetPickResult'];
    setAnchoredOverlayHiddenIds: FlowProps['onAnchoredOverlayDragHideChange'];
    onUpdateGenerate: FlowProps['onUpdateGenerate'];
    withHistoryBatch: (fn: () => void) => void;
    removeCanvasNodes: NonNullable<FlowProps['onDeleteNode']>;
    actionsRef: RefObject<{ duplicate: (id: string) => void }>;
    handleConnect: FlowProps['onConnect'];
  };

  menus: {
    connectMenu: { sourceIds: string[]; x: number; y: number } | null;
    closeConnectMenu: () => void;
    applyConnectType: ConnectMenuProps['onSelect'];
    paneMenu: PaneMenuProps['paneMenu'];
    setPaneMenu: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
    canvasHistory: CanvasHistoryApi;
    spawnNearScreen: (pt: { x: number; y: number }) => { x: number; y: number };
    paneUploadRef: RefObject<HTMLInputElement | null>;
    paneUploadPosRef: RefObject<{ x: number; y: number } | null>;
    placeFileOnCanvas: (file: File, options?: { position?: { x: number; y: number } }) => Promise<unknown>;
    handleToolMenuSelect: ToolbarProps['onMenuSelect'];
    handleUploadFile: ToolbarProps['onUploadFile'];
    placeNodeFile: NonNullable<AgentProps['onPlaceFileOnCanvas']>;
    findCanvasNode: (id: string) => Node | undefined;
    showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
  };

  nodeActions: {
    handleAddTextNode: (position?: { x: number; y: number }) => void;
    canOpenEditor: (nodeId?: string) => boolean;
    openImageDraftDialog: (nodeId: string) => void;
    createImageDraftCard: (position?: { x: number; y: number }, overrides?: { recordHistory?: boolean }) => string;
    openVideoDraftDialog: (nodeId: string, preset?: VideoGenSeedParams) => void;
    createVideoDraftCard: (seed?: VideoGenSeedParams | undefined, position?: { x: number; y: number }, overrides?: { recordHistory?: boolean }) => string;
    openAudioDraftDialog: (nodeId: string) => void;
    createAudioDraftCard: (position?: { x: number; y: number }, overrides?: { recordHistory?: boolean }) => string;
  };

  pick: {
    pickMode: CanvasPickChannel | null;
    setPickMode: (mode: CanvasPickChannel | null) => void;
    pickTarget: CanvasPickChannel | null;
    setPickTarget: (target: CanvasPickChannel | null) => void;
    pickRefRole: VideoRefRole | null;
    setPickRefRole: (role: VideoRefRole | null) => void;
    setImagePickResult: (result: { ts: number; files: UploadedFile[] } | null) => void;
    showImageDialog: PickHintProps['showImageDialog'];
    showBottomDialog: PickHintProps['showBottomDialog'];
    showAudioDialog: PickHintProps['showAudioDialog'];
    endImagePickSession: PickHintProps['onEndImagePick'];
    endVideoPickSession: PickHintProps['onEndVideoPick'];
    endAudioPickSession: PickHintProps['onEndAudioPick'];
    videoPickSessionActive: PickHintProps['videoPickSessionActive'];
    audioPickSessionActive: PickHintProps['audioPickSessionActive'];
    imagePickSessionActive: PickHintProps['imagePickSessionActive'];
    audioPickMarkedIds: string[];
    videoPickMarkedIds: string[];
    imagePickMarkedIds: string[];
    videoPickBlockedIds: string[] | undefined;
    videoDraftId: string | null | undefined;
    videoAssetPickRole: VideoRefRole | null;
    videoAssetPickKind: 'video' | 'image' | null;
    assetsPickerTarget: AssetsPickerTarget;
    openAssetsPicker: (target: AssetsPickerTarget) => void;
    setVideoAssetPickRole: (role: VideoRefRole) => void;
    setVideoAssetPickKind: (kind: 'video' | 'image') => void;
  };

  groupActions: {
    groups: FlowProps['groups'];
    handleCreateGroup: FlowProps['onCreateGroup'];
    handleUngroup: FlowProps['onUngroupGroup'];
    handleDeleteGroup: FlowProps['onDeleteGroup'];
    handleDownloadGroupNodes: FlowProps['onDownloadGroup'];
    handleGroupFrameDragStop: FlowProps['onGroupFrameDragStop'];
    handleBringGroupToFront: FlowProps['onBringGroupToFront'];
    handleConnectGroupToTarget: FlowProps['onConnectGroupToTarget'];
    handleConnectGroupDrop: FlowProps['onConnectGroupDrop'];
    handleConnectSourceToGroup: FlowProps['onConnectSourceToGroup'];
  };

  save: {
    saveStatus: BottomProps['saveStatus'];
    savedAt: BottomProps['savedAt'];
    handleRetryCanvasSave: BottomProps['onRetrySave'];
    ensureSavedBeforeProjectSwitch: () => Promise<boolean>;
    persistSnapAlignmentEnabled: (enabled: boolean) => void;
  };

  assetsPicker: {
    showAssetsPicker: boolean;
    setShowAssetsPicker: Dispatch<SetStateAction<boolean>>;
    handleAssetsPickerSelect: PickerProps['onSelect'];
  };

  agent: {
    showAgent: boolean;
    setShowAgent: Dispatch<SetStateAction<boolean>>;
    agentOpened: boolean;
    agentContext: {
      text: string;
      label?: string;
      skillId?: string;
      skillName?: string;
      ts: number;
      mediaBlocks?: AgentProps['mediaBlocks'];
    } | null;
    agentCandidate: AgentProps['candidateBlocks'];
    confirmAgentCandidate: NonNullable<AgentProps['onPrepareCandidate']>;
    cancelAgentCandidate: () => void;
    appliedCardIds: AgentProps['appliedCardIds'];
    handleAgentCardApply: AgentProps['onApplyToDock'];
    agentAssetPicks: AgentProps['externalAssetPicks'];
  };

  mediaUpdates: {
    submittingNodeId: string | null;
    audioVideoMuxInFlightSourceIds: ReadonlySet<string>;
    finalizeCtaByNodeId: Map<string, unknown>;
    regenerateCtaByNodeId: Map<string, unknown>;
    handleFinalizeSample: (nodeId: string) => void;
    handleRegenerateSample: (nodeId: string) => void;
  };

  toolbars: {
    soloMediaToolbarNode: Node | null | undefined;
    showSoloMediaToolbar: boolean;
    enhancePanelToolbarNode: Node | null;
    assetToolbarNode: Node | null | undefined;
    hoverAssetToolbarNode: Node | null | undefined;
    handleToolbarPointerEnter: ComponentProps<typeof AssetCardToolbar>['onToolbarPointerEnter'];
    handleToolbarPointerLeave: ComponentProps<typeof AssetCardToolbar>['onToolbarPointerLeave'];
  };

  projectHandlers: {
    projects: HeaderProps['projects'];
    handleSelect: HeaderProps['onSelectProject'];
    handleRename: HeaderProps['onRenameProject'];
    handleDelete: HeaderProps['onDeleteProject'];
    handleToggleProjectPin: NonNullable<HeaderProps['onTogglePinProject']>;
    handleNewProject: HeaderProps['onNewProject'];
    legacyHistory: LegacyProps['items'] | null | undefined;
    showLegacyHistory: LegacyProps['open'];
    setShowLegacyHistory: Dispatch<SetStateAction<boolean>>;
  };

  overlays: {
    assetDetailTarget: AssetDetailProps['asset'];
    assetDetailLoading: AssetDetailProps['loading'];
    handleCloseAssetDetail: NonNullable<AssetDetailProps['onClose']>;
    pendingDeleteGroup: { id: string; count: number } | null;
    setPendingDeleteGroup: Dispatch<SetStateAction<{ id: string; count: number } | null>>;
    confirmDeleteGroup: ConfirmProps['onConfirm'];
    showAssetsModal: boolean;
    setShowAssetsModal: Dispatch<SetStateAction<boolean>>;
    handleAddSharedAsset: NonNullable<SharedProps['onAddItem']>;
    assetsModalDefaultTab: SharedProps['defaultTab'];
    assetsModalDefaultFilter: SharedProps['defaultCardFilter'];
    showCharacterLibrary: boolean;
    setShowCharacterLibrary: Dispatch<SetStateAction<boolean>>;
    setCharacterLibraryTarget: Dispatch<SetStateAction<'image' | 'asset' | null>>;
    handleCharacterLibrarySelect: CharProps['onSelectAssets'];
  };
}

export default function CanvasPageShell(props: CanvasPageShellProps) {
  const {
    canvas,
    menus,
    nodeActions,
    pick,
    groupActions,
    save,
    assetsPicker,
    agent,
    mediaUpdates,
    toolbars,
    projectHandlers,
    overlays,
    shellTop,
  } = props;

  return (
    <div className={pageStyles.canvasPage}>
      <CanvasHeader
        projects={projectHandlers.projects}
        currentProjectId={shellTop.currentId ?? ''}
        onSelectProject={projectHandlers.handleSelect}
        onRenameProject={projectHandlers.handleRename}
        onDeleteProject={projectHandlers.handleDelete}
        onTogglePinProject={projectHandlers.handleToggleProjectPin}
        onNewProject={projectHandlers.handleNewProject}
        onToggleAgent={() => agent.setShowAgent(!agent.showAgent)}
        onShowLegacyHistory={projectHandlers.legacyHistory && projectHandlers.legacyHistory.length > 0 ? () => projectHandlers.setShowLegacyHistory(true) : undefined}
        hideAgentEntry={agent.showAgent}
      />
      <AssetDetailModal
        asset={overlays.assetDetailTarget}
        loading={overlays.assetDetailLoading}
        onClose={overlays.handleCloseAssetDetail}
      />
      <ConfirmModal
        open={overlays.pendingDeleteGroup !== null}
        title="删除组"
        message={`确定要删除该组及组内 ${overlays.pendingDeleteGroup?.count ?? 0} 个节点吗？确认后组内全部内容将被删除。`}
        confirmText="确认删除"
        onCancel={() => overlays.setPendingDeleteGroup(null)}
        onConfirm={overlays.confirmDeleteGroup}
      />
      <div ref={shellTop.canvasWrapperRef} data-canvas-stage className={`${pageStyles.canvasWrapper} ${pick.pickMode === 'image' ? pageStyles.pickingImage : ''}`}>
        {shellTop.applying && <div role="status" style={{ position: 'fixed', inset: 0, zIndex: 10000, cursor: 'wait' }}>正在保存画布引用…</div>}
      <AssetImageRefLimitProvider value={shellTop.assetImageRefMax ?? 0}>
      <FlowCanvas
          extraNodes={EMPTY_NODES}
          showMiniMap={canvas.showMiniMap}
          toolMode={canvas.toolMode}
          textNodes={canvas.textNodes}
          mediaNodes={canvas.mediaNodes.map((source) => {
            const node = shellTop.toolSessions.decorateNode(source);
            const finalizeCta = mediaUpdates.finalizeCtaByNodeId.get(node.id);
            const regenerateCta = mediaUpdates.regenerateCtaByNodeId.get(node.id);
            if (node.id !== mediaUpdates.submittingNodeId && !mediaUpdates.audioVideoMuxInFlightSourceIds.has(node.id) && !finalizeCta && !regenerateCta) return node;
            return { ...node, data: { ...node.data,
              ...(node.id === mediaUpdates.submittingNodeId ? { submitting: true } : {}),
              ...(mediaUpdates.audioVideoMuxInFlightSourceIds.has(node.id) ? { audioVideoMuxInFlight: true } : {}),
              ...(finalizeCta ? { finalizeCta, onFinalizeSample: mediaUpdates.handleFinalizeSample } : {}),
              ...(regenerateCta ? { regenerateCta, onRegenerateSample: mediaUpdates.handleRegenerateSample } : {}),
            } };
          })}
          productNodes={canvas.productNodes}
          assetNodes={canvas.assetNodes}
          showEdges={canvas.showEdges}
          snapAlignmentEnabled={canvas.snapAlignmentOn}
          followToolbarLayer={
            <>
              {toolbars.soloMediaToolbarNode ? (
                <NodeFollowToolbar
                  nodeId={toolbars.soloMediaToolbarNode.id}
                  show={toolbars.showSoloMediaToolbar && !shellTop.toolSessions.isModal()}
                  hovered={
                    toolbars.enhancePanelToolbarNode != null
                    && toolbars.enhancePanelToolbarNode.id === toolbars.soloMediaToolbarNode.id
                  }
                >
                  <MediaNodeToolbar
                    id={toolbars.soloMediaToolbarNode.id}
                    data={{
                      ...toolbars.soloMediaToolbarNode.data,
                      ...(mediaUpdates.audioVideoMuxInFlightSourceIds.has(toolbars.soloMediaToolbarNode.id)
                        ? { audioVideoMuxInFlight: true }
                        : {}),
                    } as MediaNodeData}
                  />
                </NodeFollowToolbar>
              ) : null}
              {toolbars.assetToolbarNode ? (
                <NodeFollowToolbar
                  nodeId={toolbars.assetToolbarNode.id}
                  hovered={toolbars.hoverAssetToolbarNode != null}
                  toolbarLift={ASSET_TOOLBAR_LIFT}
                  show={assetCardToolbarVisible(
                    ((toolbars.assetToolbarNode.data ?? {}) as { kind?: AssetCardKind }).kind,
                  )}
                >
                  <AssetCardToolbar
                    id={toolbars.assetToolbarNode.id}
                    data={toolbars.assetToolbarNode.data as AssetCardNodeData}
                    onToolbarPointerEnter={toolbars.handleToolbarPointerEnter}
                    onToolbarPointerLeave={toolbars.handleToolbarPointerLeave}
                  />
                </NodeFollowToolbar>
              ) : null}
            </>
          }
          {...shellTop.toolSessions.canvasLayers()}
          edges={canvas.edges}
          onEdgesChange={canvas.guardEdgesChange}
          onConnect={canvas.handleConnect}
          onConnectStart={(nodeId) => {
            canvas.connectingSourceRef.current = nodeId;
            shellTop.toolSessions.wireStart(nodeId);
          }}
          onConnectEnd={canvas.handleConnectEnd}
          isValidConnection={canvas.isValidCanvasConnection}
          viewport={canvas.focusViewport ?? canvas.docViewport}
          onViewportChange={canvas.setViewport}
          onViewportLive={canvas.setLiveViewport}
          registerSpawnPosition={canvas.registerSpawnPosition}
          hideZoomControl={agent.showAgent}
          onNodeDragStop={canvas.handleNodeDragStop}
          onNodeClick={canvas.handleCanvasNodeClick}
          onPaneClick={canvas.handleCanvasPaneClick}
          onSelectionChange={canvas.handleSelectionChangeStable}
          refPickActive={pick.imagePickSessionActive || pick.videoPickSessionActive || pick.audioPickSessionActive || shellTop.toolSessions.blocksCanvasDrag()}
          refPickMarkedIds={
            pick.audioPickSessionActive ? pick.audioPickMarkedIds
              : pick.videoPickSessionActive ? pick.videoPickMarkedIds
                : pick.imagePickMarkedIds
          }
          refPickBlockedIds={pick.videoPickSessionActive ? pick.videoPickBlockedIds : undefined}
          selectRequest={canvas.selectRequest}
          selectManyRequest={canvas.selectManyRequest}
          productPickResult={canvas.productPickResult}
          assetPickResult={canvas.assetPickResult}
          onDeleteNode={(ids) => {
            canvas.removeCanvasNodes(ids);
          }}
          onDuplicateSelected={(ids) => {
            canvas.withHistoryBatch(() => {
              ids.forEach((id) => canvas.actionsRef.current.duplicate(id));
            });
          }}
          onCopySelected={shellTop.handleCopySelectedNodes}
          onPasteClipboard={shellTop.handlePasteClipboard}
          groups={groupActions.groups}
          onCreateGroup={groupActions.handleCreateGroup}
          onUngroupGroup={groupActions.handleUngroup}
          onDeleteGroup={groupActions.handleDeleteGroup}
          onDownloadGroup={groupActions.handleDownloadGroupNodes}
          onGroupFrameDragStop={groupActions.handleGroupFrameDragStop}
          onBringGroupToFront={groupActions.handleBringGroupToFront}
          onConnectGroupToTarget={groupActions.handleConnectGroupToTarget}
          onConnectGroupDrop={groupActions.handleConnectGroupDrop}
          onConnectSourceToGroup={groupActions.handleConnectSourceToGroup}
          onPaneContextMenu={(pt) => menus.setPaneMenu({ x: pt.clientX, y: pt.clientY })}
          onAnchoredOverlayDragHideChange={canvas.setAnchoredOverlayHiddenIds}
          onUpdateGenerate={canvas.onUpdateGenerate}
        />
      </AssetImageRefLimitProvider>
        {menus.connectMenu && (
          <ConnectTypeMenu
            x={menus.connectMenu.x}
            y={menus.connectMenu.y}
            enabled={availableGenKinds(menus.connectMenu.sourceIds.map(menus.findCanvasNode).filter((n): n is Node => !!n))}
            onClose={menus.closeConnectMenu}
            onSelect={menus.applyConnectType}
          />
        )}
        <CanvasPaneContextMenu
          paneMenu={menus.paneMenu}
          canUndo={shellTop.toolSessions.eraseHistory().active ? shellTop.toolSessions.eraseHistory().canUndo : menus.canvasHistory.canUndo}
          canRedo={shellTop.toolSessions.eraseHistory().active ? shellTop.toolSessions.eraseHistory().canRedo : menus.canvasHistory.canRedo}
          onClose={() => menus.setPaneMenu(null)}
          onUpload={() => {
            menus.paneUploadPosRef.current = menus.spawnNearScreen(menus.paneMenu!);
            menus.paneUploadRef.current?.click();
          }}
          onAddNode={(kind) => {
            const flow = menus.spawnNearScreen(menus.paneMenu!);
            if (kind === 'text') nodeActions.handleAddTextNode(flow);
            else if (kind === 'image') {
              if (!nodeActions.canOpenEditor()) return;
              nodeActions.openImageDraftDialog(nodeActions.createImageDraftCard(flow, { recordHistory: true }));
            } else if (kind === 'video') {
              if (!nodeActions.canOpenEditor()) return;
              nodeActions.openVideoDraftDialog(nodeActions.createVideoDraftCard(undefined, flow, { recordHistory: true }));
            } else if (kind === 'audio') {
              if (!nodeActions.canOpenEditor()) return;
              nodeActions.openAudioDraftDialog(nodeActions.createAudioDraftCard(flow, { recordHistory: true }));
            }
          }}
          onUndo={() => {
            if (shellTop.toolSessions.eraseHistory().active) shellTop.toolSessions.eraseHistory().undo();
            else menus.canvasHistory.undo();
          }}
          onRedo={() => {
            if (shellTop.toolSessions.eraseHistory().active) shellTop.toolSessions.eraseHistory().redo();
            else menus.canvasHistory.redo();
          }}
        />
        <input
          ref={menus.paneUploadRef}
          type="file"
          hidden
          multiple
          accept="image/*,video/*,audio/*"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            const pos = menus.paneUploadPosRef.current;
            files.forEach((file, index) => {
              void menus.placeFileOnCanvas(file, {
                position: pos ? { x: pos.x + index * 24, y: pos.y + index * 24 } : undefined,
              }).catch((err) => {
                menus.showToast('error', isFileRejected(err) ? err.message : `「${file.name}」添加失败，请重试`);
              });
            });
            e.target.value = '';
            menus.paneUploadPosRef.current = null;
          }}
        />
        <CanvasToolbar
          mode={canvas.toolMode}
          onModeChange={canvas.setToolMode}
          onUploadFile={menus.handleUploadFile}
          onOpenAssetsPicker={() => pick.openAssetsPicker('toolbar')}
          onToggleVideoDialog={() => {
            if (!nodeActions.canOpenEditor()) return;
            pick.setPickMode(null);
            pick.setPickTarget(null);
            pick.setPickRefRole(null);
            const draftId = nodeActions.createVideoDraftCard(undefined, undefined, { recordHistory: true });
            nodeActions.openVideoDraftDialog(draftId);
          }}
          onToggleImageDialog={() => {
            if (!nodeActions.canOpenEditor()) return;
            pick.setPickMode(null);
            pick.setPickTarget(null);
            pick.setImagePickResult(null);
            const draftId = nodeActions.createImageDraftCard(undefined, { recordHistory: true });
            nodeActions.openImageDraftDialog(draftId);
          }}
          onToggleAudioDialog={() => {
            if (!nodeActions.canOpenEditor()) return;
            pick.setPickMode(null);
            pick.setPickTarget(null);
            const draftId = nodeActions.createAudioDraftCard(undefined, { recordHistory: true });
            nodeActions.openAudioDraftDialog(draftId);
          }}
          showVideoDialog={pick.showBottomDialog}
          showImageDialog={pick.showImageDialog}
          showAudioDialog={pick.showAudioDialog}
          onAddTextNode={() => nodeActions.handleAddTextNode()}
          onMenuSelect={menus.handleToolMenuSelect}
        />
        <CanvasBottomLeftActions
          showMiniMap={canvas.showMiniMap}
          showEdges={canvas.showEdges}
          snapAlignmentOn={canvas.snapAlignmentOn ?? false}
          saveStatus={save.saveStatus}
          savedAt={save.savedAt}
          onBackHome={() => { void save.ensureSavedBeforeProjectSwitch().then((ok) => { if (ok) shellTop.navigate('/'); }); }}
          onToggleMiniMap={() => canvas.setShowMiniMap(!canvas.showMiniMap)}
          onToggleEdges={() => canvas.setShowEdges(!canvas.showEdges)}
          onToggleSnap={() => {
            const next = !canvas.snapAlignmentOn;
            canvas.setSnapAlignmentOn(next);
            save.persistSnapAlignmentEnabled(next);
          }}
          onRetrySave={save.handleRetryCanvasSave}
        />
        {shellTop.generationDock.render()}
        {shellTop.toolSessions.render(shellTop.generationDock.renderedToolKinds)}
        <CanvasPickHint
          pickMode={pick.pickMode}
          pickTarget={pick.pickTarget}
          pickRefRole={pick.pickRefRole}
          imagePickSessionActive={pick.imagePickSessionActive}
          videoPickSessionActive={pick.videoPickSessionActive}
          audioPickSessionActive={pick.audioPickSessionActive}
          showImageDialog={pick.showImageDialog}
          showBottomDialog={pick.showBottomDialog}
          showAudioDialog={pick.showAudioDialog}
          onEndImagePick={pick.endImagePickSession}
          onEndVideoPick={pick.endVideoPickSession}
          onEndAudioPick={pick.endAudioPickSession}
        />
      </div>
      {(agent.showAgent || agent.agentOpened) && (
        <AgentPanel
          key={shellTop.currentId}
          open={agent.showAgent}
          onClose={() => agent.setShowAgent(false)}
          initialInput={agent.agentContext?.text ?? ''}
          initialCardLabel={agent.agentContext?.label}
          inputVersion={agent.agentContext?.ts ?? 0}
          projectId={shellTop.currentId || undefined}
          onApplyToDock={agent.handleAgentCardApply}
          appliedCardIds={agent.appliedCardIds}
          initialSkillId={agent.agentContext?.skillId ?? ''}
          initialSkillName={agent.agentContext?.skillName ?? ''}
          mediaBlocks={agent.agentContext?.mediaBlocks}
          candidateBlocks={agent.agentCandidate}
          onPrepareCandidate={agent.confirmAgentCandidate}
          onCancelCandidate={agent.cancelAgentCandidate}
          onPlaceFileOnCanvas={menus.placeNodeFile}
          onPickFromAssets={() => pick.openAssetsPicker('agentPanel')}
          externalAssetPicks={agent.agentAssetPicks}
        />
      )}
      {assetsPicker.showAssetsPicker && (
        <AssetsPickerModal
          onClose={() => assetsPicker.setShowAssetsPicker(false)}
          onSelect={assetsPicker.handleAssetsPickerSelect}
          mediaTypes={assetsPickerMediaTypes(pick.assetsPickerTarget, pick.videoAssetPickRole ?? 'reference', pick.videoAssetPickKind ?? 'video')}
          confirmText={pick.assetsPickerTarget === 'toolbar' ? '插入画布' : '确定'}
          showLivenessTab={pick.assetsPickerTarget === 'toolbar' || pick.assetsPickerTarget === 'videoDraft'}
          showCharacterTab={pick.assetsPickerTarget === 'videoDraft'}
          rejectUnapprovedForVideo={pick.assetsPickerTarget === 'videoDraft'}
        />
      )}
      {overlays.showAssetsModal && (
        <SharedAssetsModal
          onClose={() => overlays.setShowAssetsModal(false)}
          projectId={shellTop.currentId ?? ''}
          onAddItem={(item) => overlays.handleAddSharedAsset(item).then((ok) => {
            if (ok) overlays.setShowAssetsModal(false);
            return ok;
          })}
          onToast={menus.showToast}
          defaultTab={overlays.assetsModalDefaultTab}
          defaultCardFilter={overlays.assetsModalDefaultFilter}
        />
      )}
      {overlays.showCharacterLibrary && (
        <CharacterLibraryModal
          onClose={() => {
            overlays.setShowCharacterLibrary(false);
            overlays.setCharacterLibraryTarget(null);
          }}
          onSelectAssets={overlays.handleCharacterLibrarySelect}
        />
      )}
      <LegacyHistoryModal
        open={projectHandlers.showLegacyHistory}
        items={projectHandlers.legacyHistory ?? []}
        onClose={() => projectHandlers.setShowLegacyHistory(false)}
      />
      <CanvasToast toast={shellTop.toast} />
    </div>
  );
}
