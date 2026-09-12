// @vitest-environment jsdom
/* promptRefDoc 等价性测试（IKFA1M）：doc→节点→doc 往返、@ 查询匹配、查询替换为标签 */
import { describe, expect, it } from 'vitest';
import {
  $createRangeSelection,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $nodesOfType,
  $setSelection,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import type { PromptDoc } from '@/lib/prompt-doc';
import { $createAssetRefNode, AssetRefNode } from './AssetRefNode';
import { $buildFromPromptDoc, $readPromptDoc, matchMentionQuery } from './promptRefDoc';

function headless(): LexicalEditor {
  return createEditor({ namespace: 'test', nodes: [AssetRefNode], onError: (e) => { throw e; } });
}

const DOC: PromptDoc = {
  version: 1,
  segments: [
    { kind: 'text', text: '让' },
    { kind: 'asset_ref', asset_id: '102', label: '图片2' },
    { kind: 'text', text: '的人物穿上' },
    { kind: 'asset_ref', asset_id: '101', label: '图片1' },
    { kind: 'text', text: '的衣服\n\n背景换成海边' },
  ],
};

describe('$buildFromPromptDoc ↔ $readPromptDoc（往返等价）', () => {
  it('结构化正文往返：文字、标签身份、编号缓存、失效信息、段落分隔逐字一致', () => {
    const editor = headless();
    editor.update(() => {
      $buildFromPromptDoc(DOC, '');
      expect($readPromptDoc()).toEqual(DOC);
    });
  });

  it('失效标签往返：invalid_label 保留（刷新后仍显示失效，C4）', () => {
    const invalid: PromptDoc = {
      version: 1,
      segments: [
        { kind: 'text', text: '让' },
        { kind: 'asset_ref', asset_id: '102', label: '图片2', invalid_label: '图片2' },
        { kind: 'text', text: '微笑' },
      ],
    };
    const editor = headless();
    editor.update(() => {
      $buildFromPromptDoc(invalid, '');
      expect($readPromptDoc()).toEqual(invalid);
    });
  });

  it('纯文本兜底（旧草稿）：build 后读出单个 text 片段', () => {
    const editor = headless();
    editor.update(() => {
      $buildFromPromptDoc(null, '旧纯文本提示词');
      expect($readPromptDoc()).toEqual({
        version: 1,
        segments: [{ kind: 'text', text: '旧纯文本提示词' }],
      });
    });
  });
});

describe('matchMentionQuery（@ 查询检测）', () => {
  it('句中 @ 触发并取查询词（A1：任意光标位置）', () => {
    expect(matchMentionQuery('让@')).toEqual({ query: '' });
    expect(matchMentionQuery('让@猫')).toEqual({ query: '猫' });
    expect(matchMentionQuery('@abc')).toEqual({ query: 'abc' });
  });

  it('空白/换行后 @ 触发；查询不含 @/空白（连续 @ 时最后一个 @ 为新触发）', () => {
    expect(matchMentionQuery('你好 @猫')).toEqual({ query: '猫' });
    expect(matchMentionQuery('让@猫 穿上')).toBeNull();
    expect(matchMentionQuery('让@@')).toEqual({ query: '' });
    expect(matchMentionQuery('普通文字')).toBeNull();
  });
});

describe('@ 查询原位替换为素材标签（A1：保留前后文字）', () => {
  it('选中 @查询 范围插入标签：查询文本消失，前后文字保留', () => {
    const editor = headless();
    editor.update(() => {
      $buildFromPromptDoc(null, '让@猫的衣服');
      // 模拟 MentionPlugin 记录的锚点：'@' 在文本节点偏移 1，query='猫'，范围 [1, 3)
      const textNode = $getRoot().getFirstChild()?.getFirstChild();
      if (!textNode || !$isRangeSelection(null)) return;
      const key = textNode.getKey();
      const selection = $createRangeSelection();
      selection.anchor.set(key, 1, 'text');
      selection.focus.set(key, 3, 'text');
      $setSelection(selection);
      const insertion = $getSelection();
      if ($isRangeSelection(insertion)) {
        insertion.insertNodes([$createAssetRefNode('102', '图片2')]);
      }
      expect($readPromptDoc()).toEqual({
        version: 1,
        segments: [
          { kind: 'text', text: '让' },
          { kind: 'asset_ref', asset_id: '102', label: '图片2' },
          { kind: 'text', text: '的衣服' },
        ],
      });
      // 查询锚点节点仍可追溯（未被整体替换）
      expect($getNodeByKey(key)).not.toBeNull();
      expect($nodesOfType(AssetRefNode)).toHaveLength(1);
    });
  });

  it('同一素材可插入多次（A4：各次提及指向同一输入）', () => {
    const editor = headless();
    editor.update(() => {
      $buildFromPromptDoc(
        { version: 1, segments: [{ kind: 'text', text: '甲段\n\n乙段' }] },
        '',
      );
      const root = $getRoot();
      root.getFirstChild()?.append($createAssetRefNode('102', '图片2'));
      root.getLastChild()?.append($createAssetRefNode('102', '图片2'));
      const doc = $readPromptDoc();
      expect(doc.segments.filter((s) => s.kind === 'asset_ref')).toHaveLength(2);
      expect(doc.segments.map((s) => (s.kind === 'text' ? s.text : s.asset_id)).join('|')).toBe(
        '甲段|102|\n\n乙段|102',
      );
    });
  });
});
