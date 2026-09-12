/* ============================================
 * prompt-doc 纯逻辑层测试（IKFA1M）：编号派生、拍平镜像、草稿恢复防丢失、失效重派生
 * 与 packages/contracts/src/prompt-doc.ts 同语义（web 侧镜像，契约权威在服务端包）
 * ============================================ */
import { describe, expect, it } from 'vitest';
import {
  docHasAnyRef,
  docHasInvalidRef,
  flattenPromptDocWith,
  imageRefLabelOf,
  imageRefNumberOf,
  reconcilePromptDoc,
  reconcilePromptDocWith,
  restorePromptDoc,
  textRefLabelOf,
  docHasTextRef,
  type PromptDoc,
} from './prompt-doc';

const DOC: PromptDoc = {
  version: 1,
  segments: [
    { kind: 'text', text: '让' },
    { kind: 'asset_ref', asset_id: '102' },
    { kind: 'text', text: '穿上' },
    { kind: 'asset_ref', asset_id: '101' },
    { kind: 'text', text: '的衣服' },
  ],
};

describe('imageRefNumberOf / imageRefLabelOf（编号派生）', () => {
  it('编号 = assetId 在最终输入顺序中的下标+1；不在集合返回 null', () => {
    expect(imageRefNumberOf('101', ['101', '102'])).toBe(1);
    expect(imageRefNumberOf('102', ['101', '102'])).toBe(2);
    expect(imageRefNumberOf('999', ['101', '102'])).toBeNull();
    expect(imageRefLabelOf('102', ['101', '102'])).toBe('图片2');
    expect(imageRefLabelOf('999', ['101', '102'])).toBeNull();
  });
});

describe('reconcilePromptDoc（生图编号重派生）', () => {
  it('有效标签编号跟真实输入顺序（先提图片2 也按真实顺序派生）', () => {
    const { doc } = reconcilePromptDoc(DOC, ['101', '102']);
    expect(doc.segments).toEqual(DOC.segments.map((segment) =>
      segment.kind === 'asset_ref' ? { ...segment, label: `图片${['101', '102'].indexOf(segment.asset_id) + 1}` } : segment));
  });

  it('身份不在集合 → 失效保留原编号（已失效：原图片N 语义由 invalid_label 承载）', () => {
    const doc: PromptDoc = {
      version: 1,
      segments: [
        { kind: 'text', text: '让' },
        { kind: 'asset_ref', asset_id: '102', label: '图片2' },
        { kind: 'text', text: '微笑' },
      ],
    };
    const { doc: invalid } = reconcilePromptDoc(doc, ['101']);
    expect(invalid.segments[1]).toEqual({ kind: 'asset_ref', asset_id: '102', label: '图片2', invalid_label: '图片2' });
  });
});

describe('restorePromptDoc（草稿恢复防丢失）', () => {
  const stored = { version: 1, segments: DOC.segments, flat: '让图片2穿上图片1的衣服' };

  it('flat 与 prompt 镜像一致 → 恢复结构', () => {
    expect(restorePromptDoc(stored, '让图片2穿上图片1的衣服')).toEqual({
      version: 1,
      segments: DOC.segments,
    });
  });

  it('旧客户端改写过 prompt（flat 不一致）→ 丢弃结构不猜造（E1）', () => {
    expect(restorePromptDoc(stored, '让图片2的衣服改过了')).toBeNull();
  });

  it('无结构 / 版本不符 / 形状非法 → null', () => {
    expect(restorePromptDoc(undefined, 'x')).toBeNull();
    expect(restorePromptDoc({ version: 2, segments: [], flat: '' }, '')).toBeNull();
    expect(restorePromptDoc({ version: 1, segments: [{ kind: 'ref' }], flat: '' }, '')).toBeNull();
    expect(restorePromptDoc({ version: 1, segments: 'x', flat: '' }, '')).toBeNull();
  });
});

describe('reconcilePromptDoc（编号重派生与失效标记）', () => {
  it('有效标签按当前输入重派生展示编号（label 缓存同步）', () => {
    const { doc, changed } = reconcilePromptDoc(DOC, ['102', '101']);
    expect(changed).toBe(true);
    const refs = doc.segments.filter((s) => s.kind === 'asset_ref');
    expect(refs[0]).toEqual({ kind: 'asset_ref', asset_id: '102', label: '图片1' });
    expect(refs[1]).toEqual({ kind: 'asset_ref', asset_id: '101', label: '图片2' });
  });

  it('参考被移除：有效标签转失效并保留原编号，不转向其他素材（B1 基础）', () => {
    const labeled: PromptDoc = {
      version: 1,
      segments: [
        { kind: 'asset_ref', asset_id: '101', label: '图片1' },
        { kind: 'asset_ref', asset_id: '102', label: '图片2' },
        { kind: 'asset_ref', asset_id: '103', label: '图片3' },
      ],
    };
    // 移除 102：103 重编号为图片2，102 失效显示原图片2
    const { doc } = reconcilePromptDoc(labeled, ['101', '103']);
    expect(doc.segments).toEqual([
      { kind: 'asset_ref', asset_id: '101', label: '图片1' },
      { kind: 'asset_ref', asset_id: '102', label: '图片2', invalid_label: '图片2' },
      { kind: 'asset_ref', asset_id: '103', label: '图片2' },
    ]);
  });

  it('身份回到当前有效集合 → 自动恢复并派生当次编号；多次提及全部恢复（B4/C4）', () => {
    const doc: PromptDoc = {
      version: 1,
      segments: [
        { kind: 'text', text: '让' },
        { kind: 'asset_ref', asset_id: '102', label: '图片2', invalid_label: '图片2' },
        { kind: 'text', text: '拿着' },
        { kind: 'asset_ref', asset_id: '102', label: '图片2', invalid_label: '图片2' },
        { kind: 'text', text: '的包' },
      ],
    };
    // 102 以新输入顺序加回（末位 → 图片3）：失效标记清除，编号按当次输入派生
    const result = reconcilePromptDoc(doc, ['101', '103', '102']);
    expect(result.changed).toBe(true);
    expect(result.doc.segments).toEqual([
      { kind: 'text', text: '让' },
      { kind: 'asset_ref', asset_id: '102', label: '图片3' },
      { kind: 'text', text: '拿着' },
      { kind: 'asset_ref', asset_id: '102', label: '图片3' },
      { kind: 'text', text: '的包' },
    ]);
  });

  it('加回的是其他身份（同名不同素材）→ 不恢复原失效标签（B3）', () => {
    const doc: PromptDoc = {
      version: 1,
      segments: [{ kind: 'asset_ref', asset_id: '102', label: '图片2', invalid_label: '图片2' }],
    };
    // 104 与 102 同名（名称不参与判定）：102 的失效标签原样保留
    const result = reconcilePromptDoc(doc, ['101', '103', '104']);
    expect(result.changed).toBe(false);
    expect(result.doc.segments[0]).toEqual({
      kind: 'asset_ref',
      asset_id: '102',
      label: '图片2',
      invalid_label: '图片2',
    });
  });

  it('失效→恢复→再失效：原编号随最新一轮有效展示刷新（状态由当前集合推导）', () => {
    const start: PromptDoc = {
      version: 1,
      segments: [{ kind: 'asset_ref', asset_id: '102', label: '图片2', invalid_label: '图片2' }],
    };
    const restored = reconcilePromptDoc(start, ['101', '103', '102']).doc;
    // 再次移除 102：失效展示的原编号是恢复后的当次编号（图片3），不是历史图片2
    const removed = reconcilePromptDoc(restored, ['101', '103']).doc;
    expect(removed.segments[0]).toEqual({
      kind: 'asset_ref',
      asset_id: '102',
      label: '图片3',
      invalid_label: '图片3',
    });
  });

  it('无变化时返回原引用（changed=false）', () => {
    const labeled: PromptDoc = {
      version: 1,
      segments: [{ kind: 'asset_ref', asset_id: '101', label: '图片1' }],
    };
    const result = reconcilePromptDoc(labeled, ['101']);
    expect(result.changed).toBe(false);
    expect(result.doc).toBe(labeled);
  });
});

describe('docHasAnyRef / docHasInvalidRef', () => {
  it('识别标签存在与失效存在', () => {
    expect(docHasAnyRef(DOC)).toBe(true);
    expect(docHasInvalidRef(DOC)).toBe(false);
    expect(docHasAnyRef({ version: 1, segments: [{ kind: 'text', text: 'x' }] })).toBe(false);
    expect(
      docHasInvalidRef({
        version: 1,
        segments: [{ kind: 'asset_ref', asset_id: '1', invalid_label: '图片1' }],
      }),
    ).toBe(true);
  });
});

/* ============ IKFA1O：泛化标签派生（视频角色/模式失效语义） ============ */

/** 视频场景 labelOf 模拟：keyframe 模式只有帧身份有效，普通参考身份返回 null（模式不兼容） */
const keyframeLabelOf = (key: { kind: 'asset_ref' | 'text_ref'; id: string }): string | null => {
  const id = key.id;
  return id === '201' ? '首帧' : id === '202' ? '尾帧' : null;
};

describe('reconcilePromptDocWith（泛化 labelOf，IKFA1O）', () => {
  it('标签文案跟随 labelOf 派生：普通参考改为首帧后，同身份标签同步为首帧（C1）', () => {
    const doc: PromptDoc = {
      version: 1,
      segments: [{ kind: 'asset_ref', asset_id: '201', label: '图片1' }],
    };
    const result = reconcilePromptDocWith(doc, keyframeLabelOf);
    expect(result.changed).toBe(true);
    expect(result.doc.segments[0]).toEqual({ kind: 'asset_ref', asset_id: '201', label: '首帧' });
  });

  it('身份在参考集合但 labelOf 返回 null（模式不兼容）→ 失效并保留原指向（C2）', () => {
    const doc: PromptDoc = {
      version: 1,
      segments: [{ kind: 'asset_ref', asset_id: '101', label: '图片1' }],
    };
    const result = reconcilePromptDocWith(doc, keyframeLabelOf);
    expect(result.doc.segments[0]).toEqual({
      kind: 'asset_ref',
      asset_id: '101',
      label: '图片1',
      invalid_label: '图片1',
    });
  });

  it('失效标签身份仍在集合但模式仍不兼容（labelOf 仍 null）→ 不误恢复（C5）；模式切回兼容才恢复', () => {
    const invalid: PromptDoc = {
      version: 1,
      segments: [{ kind: 'asset_ref', asset_id: '101', label: '图片1', invalid_label: '图片1' }],
    };
    expect(reconcilePromptDocWith(invalid, keyframeLabelOf).doc).toBe(invalid); // 仍不兼容：原样保留
    const allLabelOf = (key: { kind: 'asset_ref' | 'text_ref'; id: string }): string | null => (key.id === '101' ? '图片1' : null);
    const restored = reconcilePromptDocWith(invalid, allLabelOf);
    expect(restored.doc.segments[0]).toEqual({ kind: 'asset_ref', asset_id: '101', label: '图片1' });
  });

  it('素材库身份（asset- 前缀）与视频编号文案同样派生', () => {
    const refsLabelOf = (key: { kind: 'asset_ref' | 'text_ref'; id: string }): string | null => {
      const id = key.id;
      return id === 'asset-x1' ? '视频2' : id === '401' ? '音频1' : null;
    };
    const doc: PromptDoc = {
      version: 1,
      segments: [
        { kind: 'asset_ref', asset_id: 'asset-x1', label: '视频1' },
        { kind: 'text', text: '和' },
        { kind: 'asset_ref', asset_id: '401' },
      ],
    };
    const result = reconcilePromptDocWith(doc, refsLabelOf);
    expect(result.doc.segments[0]).toEqual({ kind: 'asset_ref', asset_id: 'asset-x1', label: '视频2' });
    expect(result.doc.segments[2]).toEqual({ kind: 'asset_ref', asset_id: '401', label: '音频1' });
  });
});

describe('flattenPromptDocWith（泛化拍平，IKFA1O）', () => {
  it('有效标签按 labelOf 文案拍平，失效标签保留原编号（视频首尾帧/多类型）', () => {
    const doc: PromptDoc = {
      version: 1,
      segments: [
        { kind: 'text', text: '从' },
        { kind: 'asset_ref', asset_id: '201', label: '首帧' },
        { kind: 'text', text: '走向' },
        { kind: 'asset_ref', asset_id: '999', label: '图片3', invalid_label: '图片3' },
      ],
    };
    expect(flattenPromptDocWith(doc, keyframeLabelOf)).toBe('从首帧走向已失效：原图片3');
  });
});

describe('text_ref 文本片段（IKFA1P 纯逻辑）', () => {
  it('restorePromptDoc 恢复 text_ref 片段；镜像不一致按纯文本恢复（防丢失语义同媒体）', () => {
    const stored = {
      version: 1,
      segments: [
        { kind: 'text', text: '按' },
        { kind: 'text_ref', node_id: 'text-1', label: '文本1' },
        { kind: 'text_ref', node_id: 'text-2', invalid_label: '文本2' },
      ],
      flat: '按文本1已失效：原文本2',
    };
    expect(restorePromptDoc(stored, '按文本1已失效：原文本2')).toEqual({
      version: 1,
      segments: [
        { kind: 'text', text: '按' },
        { kind: 'text_ref', node_id: 'text-1', label: '文本1' },
        { kind: 'text_ref', node_id: 'text-2', invalid_label: '文本2' },
      ],
    });
    expect(restorePromptDoc(stored, '旧客户端改过的文字')).toBeNull();
  });

  it('textRefLabelOf：编号跟附件顺序；不在集合返回 null（失效）', () => {
    expect(textRefLabelOf('text-b', ['text-a', 'text-b'])).toBe('文本2');
    expect(textRefLabelOf('text-x', ['text-a'])).toBeNull();
  });

  it('reconcile 文本失效与恢复：身份不在附件集合失效、回到集合恢复并派生当次编号（B1/B4）', () => {
    const labelOf = (key: { kind: 'asset_ref' | 'text_ref'; id: string }): string | null =>
      key.kind === 'text_ref'
        ? (key.id === 'text-b' ? '文本1' : null)
        : null;
    const doc: PromptDoc = { version: 1, segments: [{ kind: 'text_ref', node_id: 'text-b', label: '文本2' }] };
    const invalid = reconcilePromptDocWith(doc, (key) => (key.kind === 'text_ref' && key.id === 'text-b' ? null : null)).doc;
    expect(invalid.segments[0]).toEqual({ kind: 'text_ref', node_id: 'text-b', label: '文本2', invalid_label: '文本2' });
    const restored = reconcilePromptDocWith(invalid as PromptDoc, labelOf);
    expect(restored.doc.segments[0]).toEqual({ kind: 'text_ref', node_id: 'text-b', label: '文本1' });
  });

  it('flattenPromptDocWith 文本标签拍平；docHasTextRef / docHasAnyRef / docHasInvalidRef 认文本片段', () => {
    const doc: PromptDoc = {
      version: 1,
      segments: [
        { kind: 'text', text: '按' },
        { kind: 'text_ref', node_id: 'text-a', label: '文本1' },
        { kind: 'text', text: '与' },
        { kind: 'text_ref', node_id: 'text-x', label: '文本2', invalid_label: '文本2' },
      ],
    };
    expect(flattenPromptDocWith(doc, (key) => (key.kind === 'text_ref' && key.id === 'text-a' ? '文本1' : null)))
      .toBe('按文本1与已失效：原文本2');
    expect(docHasTextRef(doc)).toBe(true);
    expect(docHasAnyRef(doc)).toBe(true);
    expect(docHasInvalidRef(doc)).toBe(true);
  });
});
