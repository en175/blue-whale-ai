import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import BottomDialog, { type VideoDraftParamsPatch } from '@/custom/pages/CanvasPage/components/BottomDialog';
import ChatBox from '@/custom/pages/Home/components/ChatBox';
import ModelFormModal from '@/admin/pages/ModelList/ModelFormModal';
import type { AdminModel } from '@/admin/api/adminModels';
import { useCanvasUpdateGenerate } from '@/custom/pages/CanvasPage/hooks/generation/useCanvasUpdateGenerate';
import type { Node } from '@xyflow/react';
import { takeGenHandoff } from '@/custom/utils/gen-handoff';
import { setSession } from '@/shared/utils/auth';
import { cases, initialModel, isolatedModelId, modelId } from './fixtures';
import '@/custom/styles/global.css';
import '@/admin/styles/admin.css';
import './runtime.css';

const caseId = new URLSearchParams(location.search).get('case') ?? 'C1';
const current = cases.find(item => item.id === caseId) ?? cases[0];
const savedKey = `ikluvp-draft-${caseId}`;
const emit = (kind: string, data: unknown) => parent.postMessage({ source: 'ikluvp', caseId, kind, data, time: new Date().toISOString() }, location.origin);
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(requestUrl, location.href);
  if (url.origin !== location.origin) throw new Error('隔离验收页禁止外部请求');
  const response = await originalFetch(input, init);
  if (url.pathname.startsWith('/api/assets')) {
    const body = await response.clone().json();
    const preview = (parent as Window & { ikluvpPreview?: string }).ikluvpPreview;
    if (preview && body.data?.records) body.data.records.forEach((asset: { url: string }) => { asset.url = preview; });
    return new Response(JSON.stringify(body), { status: response.status, headers: response.headers });
  }
  if (url.pathname.endsWith('/generation-jobs') || url.pathname === '/__ikluvp/model') {
    emit('提交结果', { request: init?.body ? JSON.parse(String(init.body)) : null, response: await response.clone().json() });
  }
  if (!response.ok) emit('请求错误', { path: url.pathname, response: await response.clone().text() });
  return response;
};
window.addEventListener('error', event => emit('页面错误', { message: event.message }));
window.addEventListener('unhandledrejection', event => emit('页面错误', { message: String(event.reason) }));
setSession({ userId: 900001, username: '本地验收用户', email: '', phone: '', hasPassword: false, isAdmin: true });
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
const preview = (parent as Window & { ikluvpPreview?: string }).ikluvpPreview;
const videoRef = { nodeId: 'reference', assetId: '42', mediaType: 'video' as const, name: '验收参考视频 · 6 秒',
  url: preview ?? '', duration: 6, width: 640, height: 360 };

async function submit(parameters: Record<string, unknown>, references: unknown[]) {
  const response = await fetch('/api/projects/manual-project/generation-jobs', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'video', expected_output_count: 1, parameters, references }),
  });
  return response.json();
}
function CanvasLab() {
  const [draft, setDraft] = useState<Record<string, any>>(() => {
    const stored = localStorage.getItem(savedKey);
    return stored ? JSON.parse(stored) : {
      draftModelId: caseId === 'C5' ? isolatedModelId : modelId,
      draftMode: caseId === 'C4' ? 'edit' : 'extend', draftDuration: current.duration,
      draftRatio: 'adaptive', draftSize: '720p', prompt: '延长这段视频，保持画面连续',
      mediaType: 'video', draft: true, genStatus: 'draft',
    };
  });
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [open, setOpen] = useState(true);
  const [key, setKey] = useState(0);
  const [notice, setNotice] = useState('参考视频与提示词已准备。点击底部参数栏即可开始。');
  const patch = (data: Record<string, unknown>) => {
    const next = { ...draftRef.current, ...data };
    draftRef.current = next;
    localStorage.setItem(savedKey, JSON.stringify(next));
    setDraft(next);
    emit('本地草稿', next);
  };
  const onParamsChange = (data: VideoDraftParamsPatch) => {
    const next: Record<string, unknown> = {};
    for (const [from, to] of Object.entries({ modelId: 'draftModelId', mode: 'draftMode', duration: 'draftDuration',
      ratio: 'draftRatio', size: 'draftSize', prompt: 'prompt', promptDoc: 'promptDoc' })) {
      if (Object.hasOwn(data, from)) next[to] = data[from as keyof VideoDraftParamsPatch];
    }
    patch(next);
  };
  const mediaNodesRef = useRef<Node[]>([]);
  mediaNodesRef.current = [
    { id: 'draft', type: 'mediaNode', position: { x: 0, y: 0 }, data: draft },
    { id: 'reference', type: 'mediaNode', position: { x: 0, y: 0 }, data: {
      mediaType: 'video', src: videoRef.url, assetId: '42', fileName: videoRef.name, duration: 6,
    } },
  ];
  const textNodesRef = useRef<Node[]>([]);
  const edgesRef = useRef([{ id: 'ref-edge', source: 'reference', target: 'draft' }]);
  const applyingRef = useRef(false);
  const activeProjectRef = useRef('manual-project');
  const updateGenerateRef = useRef<(nodeId: string) => void>(() => {});
  const resultNotice = async (parameters: Record<string, unknown>, refs: unknown[]) => {
    const result = await submit(parameters, refs);
    setNotice(result.code === 200 ? '本地接纳成功。请在右侧检查请求和任务快照。' : `接纳拒绝：${result.msg}`);
  };
  const { handleUpdateGenerate } = useCanvasUpdateGenerate({
    currentId: 'manual-project', saveBlocked: false, saveStatus: 'saved', mediaNodesRef, textNodesRef,
    edgesRef, applyingRef, activeProjectRef, imageDraftId: null, videoDraftId: 'draft', audioDraftId: null,
    setSubmittingNodeId: () => {}, showToast: (_type, message) => { setNotice(message); emit('界面提示', message); },
    flushCanvasSave: async () => { localStorage.setItem(savedKey, JSON.stringify(draftRef.current)); return true; },
    startGenerationJob: (_kind, parameters, _assets, refOptions) => {
      void resultNotice({ ...parameters }, refOptions?.references ?? []); return true;
    },
    generationDock: { submitted: () => {} }, textAttachmentsOf: () => [],
    draftModelOf: () => ({ features: draft.draftModelId === isolatedModelId
      ? { task_types: { extend: { allowed_ratios: ['adaptive'] }, omni: {} } }
      : initialModel.features }),
    videoRefUnsupportedByModel: () => null,
    patchMediaNode: (_id, data) => patch(data), updateGenerateRef,
  });
  useEffect(() => { localStorage.setItem(savedKey, JSON.stringify(draftRef.current)); emit('本地草稿', draftRef.current); }, []);
  return <div className="canvas-lab">
    <div className="lab-tools"><button onClick={() => { setOpen(true); setKey(value => value + 1); }}>重开面板</button>
      <button onClick={() => location.reload()}>刷新测试区</button>
      <button onClick={() => void handleUpdateGenerate('draft')}>直接重新生成</button></div>
    <div className="lab-notice" role="status">{notice}</div>
    <div className="reference-card"><video src={preview} controls muted loop /><div>{videoRef.name}</div>
      <small>仅本地测试素材，已连接到视频草稿</small></div>
    {!open && <button className="reopen" onClick={() => setOpen(true)}>打开视频面板</button>}
    {open && <BottomDialog key={key} projectId="manual-project" initialText={draft.prompt}
      initialDoc={draft.promptDoc} initialParams={{ modelId: draft.draftModelId, mode: draft.draftMode,
        duration: draft.draftDuration, aspectRatio: draft.draftRatio, resolution: draft.draftSize }}
      videoDraftBinding={{ status: 'draft', restoreExisting: true, onParamsChange }}
      videoMediaRefs={{ reference: [videoRef] }}
      onClose={() => setOpen(false)} onToast={(_type, message) => setNotice(message)}
      onSend={async (prompt, options) => {
        await resultNotice({ prompt, model_id: options.modelId, mode: options.mode,
          aspect_ratio: options.aspectRatio, resolution: options.resolution, duration: options.duration },
          [{ role: 'reference', asset_id: '42', type: 'video' }]);
      }} />}
  </div>;
}
function HomeLab() {
  const location = useLocation();
  useEffect(() => {
    if (location.pathname !== '/canvas') return;
    const data = takeGenHandoff();
    if (data) emit('首页参数交接', data);
  }, [location]);
  return <div className="home-lab"><div className="lab-notice">真实首页组件。已登录隔离用户；资产选择器中只有一段验收视频。</div>
    <ChatBox draft={{ text: '延长这段视频，保持画面连续', ts: 1, mediaType: 'video' }} /></div>;
}
function AdminLab() {
  const [model, setModel] = useState<AdminModel | null>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('本地配置保存后，重新打开检查三种语义。');
  useEffect(() => { void fetch('/__ikluvp/state').then(r => r.json()).then(r => setModel(r.data.model)); }, []);
  return <div className="adminRoot admin-lab"><h2>真实模型管理表单</h2><p>{notice}</p>
    <button className="reopen" disabled={!model} onClick={() => setOpen(true)}>打开模型配置</button>
    {open && model && <ModelFormModal initial={model} models={[model]} defaultType="video"
      onClose={() => setOpen(false)} onSubmit={async (data) => {
        const response = await fetch('/__ikluvp/model', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const result = await response.json();
        if (result.code !== 200) { setNotice(result.msg); throw new Error(result.msg); }
        setModel(result.data.model); setOpen(false); setNotice('本地配置已保存。点击打开模型配置，核对刚才的选择。');
      }} />}</div>;
}
export const runtimeRoot = createRoot(document.getElementById('root')!);
runtimeRoot.render(<QueryClientProvider client={client}><MemoryRouter>
  {current.mode === 'home' ? <HomeLab /> : current.mode === 'admin' ? <AdminLab /> : <CanvasLab />}
  <Toaster />
</MemoryRouter></QueryClientProvider>);
emit('页面就绪', { caseId, components: current.mode });
