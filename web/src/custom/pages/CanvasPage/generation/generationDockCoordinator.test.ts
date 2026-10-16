import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createGenerationDockCoordinator } from './generationDockCoordinator';
import { createImageGenerationDock } from '../tools/image/imageGenerationDock';
import type { Node } from '@xyflow/react';
import { createToolSessionRuntime } from '../tool-runtime/toolSessionRuntime';
import { createToolGenerationDock } from '../tool-runtime/toolGenerationDock';
import type { ImageGenerationDockHost } from '../tools/image/imageGenerationDock';

function imageHost(nodes: Node[]): ImageGenerationDockHost {
  return {
    getNodes: () => nodes, getEdges: () => [], attachmentsOf: () => [], canOpen: () => true,
    beginEdit: () => {}, endPicking: () => {}, clearPickResult: () => {},
    patchNode: (id, data) => { const node = nodes.find(node => node.id === id)!; node.data = { ...node.data, ...data }; },
    getAvailability: () => ({ submittingNodeId: null, saveFailed: false }), getProjectId: () => 'p1', isApplying: () => false, isSaveBlocked: () => false,
    setApplying: () => {}, setSubmittingNode: () => {}, promptMaxLength: async () => 100,
    collectInputAssetIds: async () => [], save: async () => true, isProjectCurrent: () => true,
    startTask: () => false, toast: () => {}, reportError: () => {},
  };
}

describe('生成 Dock 公开协调接口', () => {
  it('无参渲染自动消费注册定义，工具渲染归属由注册元数据派生', () => {
    const definition = (text: string, tool = false) => ({
      tool, view: () => ({ visible: true }), open(_input: Record<string, unknown>) {}, hide() {}, close() {}, updateDraft(_input: never) {}, submit(_input: never) {}, render: () => createElement('span', null, text),
    });
    const dock = createGenerationDockCoordinator({ existing: definition('既有'), added: definition('新注册'), managed: definition('工具', true) });
    expect(renderToStaticMarkup(createElement(Fragment, null, dock.render()))).toContain('新注册');
    expect(dock.renderedToolKinds).toEqual(new Set(['managed']));
    expect(renderToStaticMarkup(createElement(Fragment, null, dock.render('added')))).toBe('<span>新注册</span>');
  });

  it('八种面板依次打开时只有当前注册项可见，工具状态由句柄快照提供', () => {
    const runtime = createToolSessionRuntime();
    let dismissOrdinary = () => {};
    const panel = (kind: string, tool = false) => {
      if (tool) {
        const handle = runtime.register({ kind, panel: 'preserve', initialize: (nodeId: string) => ({ nodeId }), target: state => state.nodeId, capture: () => null, submit: async () => {}, onError() {} });
        return createToolGenerationDock(handle, { createDraft: id => id, getDeps: () => ({ dismissGenPanels: () => dismissOrdinary(), selectNode() {} }), subscribe: runtime.subscribe, getVersion: runtime.getVersion });
      }
      let visible = false;
      return {
        view: () => ({ visible }), open: (_entry: Record<string, unknown>) => { visible = true; },
        hide: () => { visible = false; }, close: () => { visible = false; },
        updateDraft: (_input: never) => {}, submit: (_input: never) => {},
      };
    };
    const registry = {
      image: panel('image'), video: panel('video'), audio: panel('audio'), text: panel('text'), music: panel('music'),
      imageEnhance: panel('imageEnhance', true), videoEnhance: panel('videoEnhance', true), frameInterpolation: panel('frameInterpolation', true),
    };
    const dock = createGenerationDockCoordinator(registry);
    dismissOrdinary = () => dock.dismissAll('ordinary');
    const kinds = Object.keys(registry) as Array<keyof typeof registry>;
    for (const kind of kinds) {
      dock.open(kind, { nodeId: 'target' });
      expect(kinds.filter(key => dock.panel(key).visible)).toEqual([kind]);
      expect(dock.view.activePanel).toBe(kind);
    }
    dock.dismissAll();
    expect(kinds.filter(key => dock.panel(key).visible)).toEqual([]);
  });
  it('注册新面板即可参加互斥、发送和全量收起，准入失败保留当前面板', () => {
    const makePanel = () => {
      let visible = false;
      let draft = '';
      return {
        view: () => ({ visible, draft }),
        canOpen: (input: { allowed: boolean }) => input.allowed,
        open: (_input: { allowed: boolean }) => { visible = true; },
        hide: () => { visible = false; },
        close: () => { visible = false; draft = 'closed'; },
        updateDraft: (value: string) => { draft = value; },
        submit: (value: string) => `submitted:${value}`,
        render: () => draft,
      };
    };
    const dock = createGenerationDockCoordinator({ image: makePanel(), extra: makePanel() });
    dock.open('image', { allowed: true });
    dock.updateDraft('image', '保留草稿');
    expect(dock.open('extra', { allowed: false })).toBe(false);
    expect(dock.view.activePanel).toBe('image');
    dock.open('extra', { allowed: true });
    expect(dock.panel('image')).toEqual({ visible: false, draft: '保留草稿' });
    expect(dock.view.activePanel).toBe('extra');
    expect(dock.submit('extra', '正文')).toBe('submitted:正文');
    dock.updateDraft('extra', '新面板内容');
    expect(dock.render('extra')).toBe('新面板内容');
    dock.dismissAll();
    expect(dock.view.activePanel).toBeNull();
    expect(dock.panel('extra').draft).toBe('closed');
  });
});

describe('图片 Dock 草稿与选择', () => {
  it('重复读取与无关显隐通知保留参考派生引用，来源正文变化刷新附件', () => {
    const nodes: Node[] = [
      { id: 'draft', type: 'mediaNode', position: { x: 0, y: 0 }, data: { draft: true } },
      { id: 'text', type: 'textNode', position: { x: 0, y: 0 }, data: { text: '原文' } },
    ];
    const host = imageHost(nodes);
    host.getNodes = () => [...nodes];
    const edges = [{ id: 'edge', source: 'text', target: 'draft' }];
    host.getEdges = () => edges;
    host.attachmentsOf = () => [{ nodeId: 'text', title: '文本', text: String(nodes[1].data.text) }];
    const dock = createGenerationDockCoordinator({ image: createImageGenerationDock(() => host) });
    dock.open('image', { nodeId: 'draft' });
    const before = dock.panel('image');
    expect(dock.panel('image').attachments).toBe(before.attachments);
    expect(dock.panel('image').mediaRefs).toBe(before.mediaRefs);
    dock.selection({ soloId: null, multiSelect: true, editing: false, submittingNodeId: null });
    expect(dock.panel('image').attachments).toBe(before.attachments);
    expect(dock.panel('image').mediaRefs).toBe(before.mediaRefs);
    nodes[1] = { ...nodes[1], data: { text: '新文' } };
    expect(dock.panel('image').attachments).toEqual([{ nodeId: 'text', title: '文本', text: '新文' }]);
    expect(dock.panel('image').attachments).not.toBe(before.attachments);
  });
  it('等待模型校验时保留调用时的草稿绑定身份，引用准备仍在校验后执行', async () => {
    const nodes: Node[] = [{ id: 'draft', type: 'mediaNode', position: { x: 0, y: 0 }, data: { draft: true } }];
    const host = imageHost(nodes);
    let resolveLimit!: (value: number) => void;
    host.promptMaxLength = () => new Promise(resolve => { resolveLimit = resolve; });
    const prepared: unknown[] = [];
    host.collectInputAssetIds = async (target, _files, useEdgeRefs) => { prepared.push({ target, useEdgeRefs }); return []; };
    let otherVisible = false;
    const dock = createGenerationDockCoordinator({
      image: createImageGenerationDock(() => host),
      video: {
        view: () => ({ visible: otherVisible }), open: (_entry: Record<string, unknown>) => { otherVisible = true; },
        hide: () => { otherVisible = false; }, close: () => { otherVisible = false; },
        updateDraft: (_input: never) => {}, submit: (_input: never) => {},
      },
    });
    dock.open('image', { nodeId: 'draft' });
    const submission = dock.submit('image', { text: '鲸鱼', modelId: 'model', size: '2k', ratio: '1:1', files: [] });
    expect(prepared).toEqual([]);
    dock.open('video', {});
    expect(dock.panel('image').boundId).toBeNull();
    resolveLimit(100);
    await submission;
    expect(prepared).toEqual([{ target: 'draft', useEdgeRefs: true }]);
  });
  it('空选中与编辑会话中的同卡通知不改变可见性，选择隐藏与参考保护分别生效', () => {
    const nodes: Node[] = [{ id: 'draft', type: 'mediaNode', position: { x: 0, y: 0 }, data: { draft: true } }];
    const dock = createGenerationDockCoordinator({ image: createImageGenerationDock(() => imageHost(nodes)) });
    dock.open('image', { nodeId: 'draft' });
    dock.selection({ soloId: null, multiSelect: false, editing: false, submittingNodeId: null });
    expect(dock.view.activePanel).toBe('image');
    dock.selection({ soloId: 'draft', multiSelect: false, editing: true, submittingNodeId: null });
    expect(dock.view.activePanel).toBe('image');
    dock.selection({ soloId: null, multiSelect: true, editing: false, submittingNodeId: null });
    expect(dock.view.activePanel).toBeNull();
    dock.selection({ soloId: 'draft', multiSelect: false, editing: false, submittingNodeId: null });
    expect(dock.view.activePanel).toBe('image');
    dock.referencePicked('image');
    dock.selection({ soloId: 'reference', multiSelect: false, editing: false, submittingNodeId: null });
    expect(dock.view.activePanel).toBe('image');
  });
  it('等值打开保留初始化身份，显式关闭不受程序化选中影响，手动打开可恢复', () => {
    const nodes: Node[] = [{ id: 'draft', type: 'mediaNode', position: { x: 0, y: 0 }, data: { draft: true, prompt: '鲸鱼', draftRatio: '1:1' } }];
    const image = createImageGenerationDock(() => ({
      getNodes: () => nodes,
      getEdges: () => [],
      attachmentsOf: () => [],
      canOpen: () => true,
      beginEdit: () => {},
      endPicking: () => {},
      clearPickResult: () => {},
      getAvailability: () => ({ submittingNodeId: null, saveFailed: false }), getProjectId: () => 'p1', isApplying: () => false, isSaveBlocked: () => false,
      setApplying: () => {}, setSubmittingNode: () => {}, promptMaxLength: async () => 100,
      collectInputAssetIds: async () => [], save: async () => true, isProjectCurrent: () => true,
      startTask: () => false, toast: () => {}, reportError: () => {},
      patchNode: (id, data) => { nodes.find(node => node.id === id)!.data = { ...nodes.find(node => node.id === id)!.data, ...data }; },
    }));
    const dock = createGenerationDockCoordinator({ image });
    dock.open('image', { nodeId: 'draft' });
    const first = dock.panel('image').seed;
    dock.open('image', { nodeId: 'draft' });
    expect(dock.panel('image').seed).toBe(first);
    dock.close('image');
    expect(dock.open('image', { nodeId: 'draft', intent: 'selection' })).toBe(false);
    dock.selection({ soloId: 'draft', multiSelect: false, editing: false, submittingNodeId: null });
    expect(dock.view.activePanel).toBeNull();
    expect(dock.panel('image').boundId).toBe('draft');
    dock.open('image', { nodeId: 'draft' });
    expect(dock.view.activePanel).toBe('image');
    dock.updateDraft('image', { prompt: '蓝鲸', ratio: '16:9' });
    expect(nodes[0].data).toMatchObject({ prompt: '蓝鲸', draftRatio: '16:9', targetRatio: '16:9' });
    expect(dock.panel('image').seed).toBe(first);
    dock.open('image', { nodeId: 'draft' });
    expect(dock.panel('image').seed).not.toBe(first);
    expect(dock.panel('image').seed?.text).toBe('蓝鲸');
  });

  it('目标有生成记录时保留绑定，目标失效时关闭，订阅解除后停止通知', () => {
    const nodes: Node[] = [{ id: 'draft', type: 'mediaNode', position: { x: 0, y: 0 }, data: { draft: true } }];
    const dock = createGenerationDockCoordinator({ image: createImageGenerationDock(() => imageHost(nodes)) });
    const observed: unknown[] = [];
    const unsubscribe = dock.subscribe(() => observed.push(dock.view.activePanel));
    dock.open('image', { nodeId: 'draft' });
    nodes[0].data = { draft: false, jobId: 'job1', genStatus: 'generating' };
    dock.reconcile();
    expect(dock.panel('image').boundId).toBe('draft');
    expect(dock.panel('image').draftBinding).toMatchObject({ restoreExisting: true, status: 'generating' });
    nodes.splice(0);
    dock.reconcile();
    expect(dock.view.activePanel).toBeNull();
    expect(dock.panel('image').boundId).toBeNull();
    expect(observed).toEqual(['image', null]);
    unsubscribe();
    dock.open('image', {});
    expect(observed).toEqual(['image', null]);
  });

  it.each(['保存拒绝', '登记拒绝', '准备失败', '项目已切换'] as const)('%s保持面板并释放发送锁', async outcome => {
    const nodes: Node[] = [{ id: 'draft', type: 'mediaNode', position: { x: 0, y: 0 }, data: { draft: true } }];
    const host = imageHost(nodes);
    let applying = false;
    const requests: unknown[] = [];
    const feedback: string[] = [];
    host.setApplying = value => { applying = value; };
    host.isApplying = () => applying;
    host.save = async () => {
      if (outcome === '准备失败') throw new Error('保存失败');
      return outcome !== '保存拒绝';
    };
    host.isProjectCurrent = () => outcome !== '项目已切换';
    host.startTask = request => { requests.push(request); return false; };
    host.toast = (_type, message) => { feedback.push(message); };
    const dock = createGenerationDockCoordinator({ image: createImageGenerationDock(() => host) });
    dock.open('image', { nodeId: 'draft' });
    await dock.submit('image', { text: '鲸鱼', modelId: 'model', size: '2k', ratio: '1:1', files: [] });
    expect(dock.view.activePanel).toBe('image');
    expect(applying).toBe(false);
    expect(requests).toHaveLength(outcome === '登记拒绝' ? 1 : 0);
    expect(feedback).toEqual(outcome === '准备失败' ? ['保存或提交失败，请重试'] : []);
  });

  it('发送先校验再收集引用与保存，提交链登记后关闭并释放宿主锁', async () => {
    const events: string[] = [];
    let applying = false;
    const requests: unknown[] = [];
    const image = createImageGenerationDock(() => ({
      getNodes: () => [{ id: 'draft', type: 'mediaNode', position: { x: 0, y: 0 }, data: { draft: true, prompt: '鲸鱼' } }],
      getEdges: () => [], attachmentsOf: () => [], canOpen: () => true,
      beginEdit: () => {}, endPicking: () => {}, clearPickResult: () => {}, patchNode: () => {},
      getAvailability: () => ({ submittingNodeId: null, saveFailed: false }), getProjectId: () => 'p1', isApplying: () => applying, isSaveBlocked: () => false,
      setApplying: value => { applying = value; events.push(value ? 'lock' : 'unlock'); },
      setSubmittingNode: () => {},
      promptMaxLength: async () => { events.push('validate'); return 100; },
      collectInputAssetIds: async () => { events.push('references'); return ['asset1']; },
      save: async () => { events.push('save'); return true; },
      isProjectCurrent: () => true,
      startTask: request => { requests.push(request); events.push('registered'); return true; },
      toast: () => {}, reportError: () => {},
    }));
    const dock = createGenerationDockCoordinator({ image });
    dock.open('image', { nodeId: 'draft' });
    await dock.submit('image', { text: '鲸鱼', modelId: 'model', size: '2k', ratio: '1:1', files: [] });
    expect(events).toEqual(['validate', 'lock', 'references', 'save', 'registered', 'unlock']);
    expect(requests).toEqual([{ text: '鲸鱼', modelId: 'model', size: '2k', ratio: '1:1', references: [{ role: 'reference', type: 'image', asset_id: 'asset1' }], targetNodeId: 'draft', promptDoc: undefined }]);
    expect(dock.view.activePanel).toBeNull();
    expect(applying).toBe(false);
    dock.selection({ soloId: 'draft', multiSelect: false, editing: false, submittingNodeId: null });
    expect(dock.view.activePanel).toBeNull();
  });
});
