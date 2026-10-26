import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { boundaryCases, cases, modelId, sourceHead } from './fixtures';
import './guide.css';

type Entry = { caseId: string; kind: string; data: any; time: string };
type RecordItem = { verdict: string; note: string; events: Entry[] };
const reportKey = 'ikluvp-manual-report-v1';
async function prepareVideo() {
  if (!('MediaRecorder' in window)) throw new Error('当前浏览器不支持本地视频生成，请使用 Chrome 或 Edge 打开此页。');
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
  const context = canvas.getContext('2d')!;
  const stream = canvas.captureStream(12);
  const recorder = new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  const started = performance.now();
  const render = () => {
    const elapsed = (performance.now() - started) / 1000;
    context.fillStyle = '#153248'; context.fillRect(0, 0, 640, 360);
    context.fillStyle = '#2ed3b7'; context.beginPath(); context.arc(85 + elapsed * 65, 160, 36, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#fff'; context.font = '24px sans-serif'; context.fillText('IKLUVP 本地参考视频', 28, 48);
    context.font = '18px sans-serif'; context.fillText(`${elapsed.toFixed(1)} s / 6.0 s`, 28, 320);
  };
  render();
  const interval = setInterval(render, 80);
  return new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { clearInterval(interval); stream.getTracks().forEach(track => track.stop()); reject(new Error('本地视频生成失败')); };
    recorder.onstop = () => {
      clearInterval(interval); stream.getTracks().forEach(track => track.stop());
      resolve(new Blob(chunks, { type: recorder.mimeType }));
    };
    recorder.start(); setTimeout(() => recorder.stop(), 6000);
  });
}
export function Guide() {
  const [selected, setSelected] = useState('C1');
  const current = cases.find(item => item.id === selected)!;
  const [records, setRecords] = useState<Record<string, RecordItem>>(() => JSON.parse(localStorage.getItem(reportKey) ?? '{}'));
  const [prepared, setPrepared] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [loading, setLoading] = useState('正在生成 6 秒参考视频，首次约需 6 秒。');
  const [busy, setBusy] = useState(false);
  const [boundaryResults, setBoundaryResults] = useState<Record<string, any>>({});
  const [report, setReport] = useState('');
  const frame = useRef<HTMLIFrameElement>(null);
  const record = records[selected] ?? { verdict: '待测试', note: '', events: [] };
  const completed = Object.values(records).filter(item => item.verdict !== '待测试').length;
  const passed = Object.values(records).filter(item => item.verdict === '通过').length;
  const update = (id: string, patch: Partial<RecordItem>) => setRecords(old => ({ ...old, [id]: { ...(old[id] ?? { verdict: '待测试', note: '', events: [] }), ...patch } }));
  useEffect(() => { localStorage.setItem(reportKey, JSON.stringify(records)); }, [records]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.source !== 'ikluvp') return;
      const entry = event.data as Entry;
      setRecords(old => ({ ...old, [entry.caseId]: { ...(old[entry.caseId] ?? { verdict: '待测试', note: '', events: [] }),
        events: [...(old[entry.caseId]?.events ?? []), entry] } }));
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);
  useEffect(() => {
    void prepareVideo().then(async blob => {
      const response = await fetch('/__ikluvp/reference', { method: 'PUT', body: blob });
      if (!response.ok) throw new Error('本地参考视频准备失败');
      (window as Window & { ikluvpPreview?: string }).ikluvpPreview = '/__ikluvp/reference';
      return fetch('/__ikluvp/reset', { method: 'POST' });
    }).then(() => { setPrepared(true); setLoading(''); }).catch(error => setLoading(String(error)));
  }, []);
  async function loadCase(id: string) {
    setBusy(true);
    await fetch('/__ikluvp/reset', { method: 'POST' });
    localStorage.removeItem(`ikluvp-draft-${id}`);
    setSelected(id); setNonce(value => value + 1); setBoundaryResults({}); setBusy(false);
  }
  async function probe(item: typeof boundaryCases[number]) {
    const request = { type: 'video', expected_output_count: 1, parameters: {
      model_id: 'model' in item ? item.model : modelId, mode: item.mode, duration: item.duration,
      aspect_ratio: item.ratio, resolution: '720p', prompt: '延长这段视频，保持画面连续',
    }, references: [{ role: 'reference', type: 'video', asset_id: '42' }] };
    const response = await fetch('/api/projects/manual-project/generation-jobs', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    const result = await response.json();
    setBoundaryResults(old => ({ ...old, [item.label]: result }));
    const entry = { caseId: 'B1', kind: item.label, data: { request, response: result }, time: new Date().toISOString() };
    setRecords(old => ({ ...old, B1: { ...(old.B1 ?? { verdict: '待测试', note: '', events: [] }), events: [...(old.B1?.events ?? []), entry] } }));
  }
  function exportReport() {
    const payload = {
      issue: 'IKLUVP', type: '本地隔离人工回归', sourceHead, date: new Date().toISOString(),
      summary: { groups: cases.length, recorded: completed, passed },
      coverage: '真实 BottomDialog、ChatBox、ModelFormModal、useCanvasUpdateGenerate 与真实后端接纳/配置解析。项目、素材读取、任务写入与草稿持久化为隔离桩。',
      externalAcceptance: { testSiteDeployment: 'NOT_RUN', databasePersistence: 'NOT_RUN', workerUpstream: 'NOT_RUN', billing: 'NOT_RUN' },
      completionGate: '工程验证独立记录，以最终提交的 verify-change-scope 凭证为准。',
      cases: cases.map(item => ({ id: item.id, title: item.title, expected: item.expected, verdict: records[item.id]?.verdict ?? '待测试', note: records[item.id]?.note ?? '', evidence: records[item.id]?.events ?? [] })),
    };
    const brief = `IKLUVP 本地人工回归：${completed}/${cases.length} 组已记录，${passed} 组通过。\n` + cases.map(item => `${item.id} ${item.title}：${records[item.id]?.verdict ?? '待测试'}${records[item.id]?.note ? `；${records[item.id].note}` : ''}`).join('\n');
    setReport(brief);
    const href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = href; anchor.download = `IKLUVP-人工回归-${Date.now()}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  const latest = [...record.events].reverse().find(event => event.kind === '提交结果' || event.kind === '首页参数交接' || event.data?.response);
  const result = latest?.data?.response;
  const parameters = result?.manual_evidence?.task_snapshots?.[0]?.input ?? latest?.data?.request?.parameters;
  const handoff = latest?.kind === '首页参数交接' ? latest.data : null;
  const config = result?.data?.model?.features?.task_types?.extend;
  return <div className="app">
    <header><div><div className="eyebrow">IKLUVP · 人工验收台</div><h1>视频延长，自动与指定秒数</h1><p>素材、模型、提示词和检查项已备好。操作真实组件，再记录你的判断。</p></div>
      <div className="progress"><strong>{completed}<span> / 8</span></strong><div>组已记录 · {passed} 组通过</div><button onClick={exportReport}>导出报告与反馈摘要</button></div></header>
    <div className="boundary"><strong>本地隔离验收</strong><span>无需登录、不访问真实素材、不扣积分。通过后证明本地交互与接纳逻辑符合预期；部署、真实入队、上游生成与计费仍需环境验收。</span><details><summary>证据范围</summary><p>产品代码 {sourceHead.slice(0, 9)}。真实界面与参数校验；数据服务使用本地桩。工程门禁与部署验收由收口记录单独说明。</p></details></div>
    <div className="layout"><nav aria-label="测试分组">
      <div className="nav-title">按顺序完成 · 约 10–15 分钟</div>
      {['画布', '首页', '管理端', '边界'].map(group => <section key={group}><h3>{group}</h3>{cases.filter(item => item.group === group).map(item => <button key={item.id} disabled={!prepared || busy} className={selected === item.id ? 'active' : ''} onClick={() => void loadCase(item.id)}><span>{item.id} · {item.title}</span><small className={records[item.id]?.verdict === '通过' ? 'good' : ''}>{records[item.id]?.verdict ?? '待测试'}</small></button>)}</section>)}
      <p className="nav-note">切换组会重新准备该组数据。已经记录的结论和证据保留在此浏览器。</p>
    </nav><main>
      <section className="instructions"><div className="title-row"><h2>{current.id} · {current.title}</h2><button disabled={!prepared || busy} onClick={() => void loadCase(selected)}>重新准备本组</button></div>
        <ol>{current.steps.map(step => <li key={step}>{step}</li>)}</ol>
        <div className="expected"><b>预期结果</b><p>{current.expected}</p></div></section>
      <div className="workbench"><section className="stage"><div className="stage-label">{current.mode === 'boundary' ? '真实接纳函数 · 人工逐项触发' : '真实产品组件 · 可直接操作'}</div>
        {!prepared ? <div className="loading" role="status">{loading}</div> : busy ? <div className="loading">正在准备本组…</div> : current.mode === 'boundary' ? <table><thead><tr><th>输入</th><th>预期</th><th>操作 / 结果</th></tr></thead><tbody>{boundaryCases.map(item => {
          const actual = boundaryResults[item.label];
          const match = actual && (actual.code === 200) === item.ok && actual.manual_evidence?.created_count === (item.ok ? 1 : 0);
          return <tr key={item.label}><td>{item.label}<small>{item.mode} · {item.ratio}</small></td><td>{item.ok ? '接纳' : '拒绝且不建任务'}</td><td><button onClick={() => void probe(item)}>测试此输入</button>{actual && <div className={match ? 'good' : 'bad'}>{match ? '与预期一致' : '与预期不一致'} · code={actual.code} · 建任务 {actual.manual_evidence?.created_count ?? '?'} 次<br />{actual.msg}</div>}</td></tr>;
        })}</tbody></table> : <iframe ref={frame} key={`${selected}-${nonce}`} title={`${current.title}操作区`} src={`./runtime.html?case=${selected}&run=${nonce}`} />}
      </section><aside className="evidence"><h3>最近操作的实际证据</h3>
        {latest ? <><div className="receipt-label">{latest.kind}</div>{result && <div className="receipt"><b>业务码 {result.code}</b><p>{result.msg}</p><p>任务创建：{result.manual_evidence?.created_count ?? '配置保存'}{result.manual_evidence ? ' 次' : ''}</p></div>}
          {(parameters || handoff) && <dl><dt>模式</dt><dd>{parameters?.video_mode ?? parameters?.mode ?? handoff?.mode}</dd><dt>时长</dt><dd>{(parameters?.duration ?? handoff?.duration) === -1 ? '自动（-1）' : `${parameters?.duration ?? handoff?.duration} 秒`}</dd><dt>比例</dt><dd>{parameters?.aspect_ratio ?? handoff?.aspectRatio}</dd></dl>}
          {config && <div className="receipt"><b>延长时长配置</b><p>{config.allowed_durations ? '仅自动时长' : config.allow_auto_duration ? '自动或指定秒数' : '仅指定秒数'}</p></div>}
          <details><summary>展开完整请求与响应</summary><pre>{JSON.stringify(latest.data, null, 2)}</pre></details></> : <p className="muted">操作后显示请求、响应与内存任务快照。界面就绪不会自动判定通过。</p>}
        <details><summary>查看本组全部事件 · {record.events.length}</summary><pre>{JSON.stringify(record.events, null, 2)}</pre></details>
      </aside></div>
      <section className="verdict"><h3>你的人工结论</h3><div className="verdict-buttons">{['通过', '不通过', '受阻'].map(verdict => <button aria-pressed={record.verdict === verdict} key={verdict} onClick={() => update(selected, { verdict })}>{verdict}</button>)}<span>当前：{record.verdict}</span></div>
        <textarea aria-label="现象或备注" placeholder="不符合预期时，写下操作、实际现象和预期；有截图可在聊天中补充。" value={record.note} onChange={event => update(selected, { note: event.target.value })} />
        <div className="footer-actions"><button onClick={exportReport}>导出当前报告</button>{selected !== 'B1' && <button className="primary" disabled={!prepared} onClick={() => void loadCase(cases[cases.findIndex(item => item.id === selected) + 1].id)}>进入下一组</button>}</div></section>
      {report && <section className="report"><h3>把下面摘要复制回聊天，附上下载的 JSON 报告</h3><textarea readOnly value={report} onFocus={event => event.target.select()} /><p>此报告不会自动发送，不会把工单改为已验收。</p></section>}
    </main></div>
  </div>;
}
export const guideRoot = createRoot(document.getElementById('root')!);
guideRoot.render(<Guide />);
