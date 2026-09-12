/* ============================================
 * prompt-doc 纯逻辑层测试（IKFA1M）：编号派生、拍平镜像、草稿恢复防丢失、失效重派生
 * 与 packages/contracts/src/prompt-doc.ts 同语义（web 侧镜像，契约权威在服务端包）
 * ============================================ */
import { describe, expect, it } from 'vitest';
import {
  docHasAnyRef,
  docHasInvalidRef,
  flattenPromptDoc,
  imageRefLabelOf,
  imageRefNumberOf,
  reconcilePromptDoc,
  restorePromptDoc,
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

describe('flattenPromptDoc（拍平镜像）', () => {
  it('有效标签 → 图片N（先提图片2 也按真实顺序），文字原样', () => {
    expect(flattenPromptDoc(DOC, ['101', '102'])).toBe('让图片2穿上图片1的衣服');
  });

  it('失效标签 → 已失效：原图片N', () => {
    const doc: PromptDoc = {
      version: 1,
      segments: [
        { kind: 'text', text: '让' },
        { kind: 'asset_ref', asset_id: '102', invalid_label: '图片2' },
        { kind: 'text', text: '微笑' },
      ],
    };
    expect(flattenPromptDoc(doc, ['101'])).toBe('让已失效：原图片2微笑');
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
