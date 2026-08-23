// @vitest-environment jsdom
//
// IKAFSX 的验收有一条：「最终 prompt 与解引用前的全文一致（行为等价，不能因重构改变送给
// 模型的内容）」＋「单测：解引用后文本与旧行为逐字一致」。这条守卫此前不存在，于是重构把
// 段落分隔从 `\n\n` 悄悄改成了 `\n`（审查 W·P3）——用户在 dock 里敲三段字点生成，送出去的
// prompt 每段少一个换行，而没有任何测试会红。
//
// 这里不去背诵一个期望字符串，而是**拿旧实现当基准**：旧出口就是 `$getRoot().getTextContent()`，
// 让它和「readComposed + resolveComposed」跑同一棵树，逐字比。这样将来谁再动分隔规则，
// 红的是这条测试，不是用户的 prompt。
import { describe, expect, it } from 'vitest';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { ChipNode, $createChipNode } from './ChipNode';
import { readComposed } from './readComposed';
import { resolveComposed } from './composed';

function makeEditor(): LexicalEditor {
  return createEditor({
    nodes: [ChipNode],
    onError: (error) => {
      throw error;
    },
  });
}

/** 在一棵新树上跑 build，回来给出「旧出口」与「新出口」两份文本。 */
function bothWays(build: () => void): { legacy: string; composed: string } {
  const editor = makeEditor();
  editor.update(
    () => {
      $getRoot().clear();
      build();
    },
    { discrete: true },
  );
  return editor.getEditorState().read(() => ({
    legacy: $getRoot().getTextContent(),
    composed: resolveComposed(readComposed()),
  }));
}

function paragraph(...texts: string[]) {
  const p = $createParagraphNode();
  for (const t of texts) p.append($createTextNode(t));
  $getRoot().append(p);
  return p;
}

describe('readComposed 与旧行为逐字一致', () => {
  it('单段纯文字', () => {
    const { legacy, composed } = bothWays(() => paragraph('把镜头拉远一点'));
    expect(composed).toBe(legacy);
    expect(composed).toBe('把镜头拉远一点');
  });

  it('多段落——正是这里丢过一个换行', () => {
    const { legacy, composed } = bothWays(() => {
      paragraph('第一段');
      paragraph('第二段');
      paragraph('第三段');
    });
    expect(composed).toBe(legacy);
    // 写死一次，免得哪天 legacy 自己变了还一起绿：段落之间是两个换行，不是一个。
    expect(composed).toBe('第一段\n\n第二段\n\n第三段');
  });

  it('空段落也占一个块，不会被吞掉', () => {
    const { legacy, composed } = bothWays(() => {
      paragraph('上');
      paragraph();
      paragraph('下');
    });
    expect(composed).toBe(legacy);
    expect(composed).toBe('上\n\n\n\n下');
  });

  it('同段内的多个文本节点合并，不产生额外分隔', () => {
    const { legacy, composed } = bothWays(() => paragraph('前', '中', '后'));
    expect(composed).toBe(legacy);
    expect(composed).toBe('前中后');
  });
});

describe('胶囊在提交那一刻才解引用', () => {
  const LONG = 'x'.repeat(3000);

  it('胶囊位置不变，内容换成完整 prompt', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        $getRoot().clear();
        const p = $createParagraphNode();
        p.append($createTextNode('参考 '));
        p.append($createChipNode('r1', '镜头 3', LONG));
        p.append($createTextNode(' 重做一版'));
        $getRoot().append(p);
      },
      { discrete: true },
    );
    const value = editor.getEditorState().read(() => readComposed());

    // 编辑期是指针：一个胶囊就是一个 ref 片段，背后 3000 字不进片段序列。
    expect(value.segments.map((s) => s.kind)).toEqual(['text', 'ref', 'text']);
    // 提交那一刻才展开。
    expect(resolveComposed(value)).toBe(`参考 ${LONG} 重做一版`);
  });

  it('跨段落的胶囊同样保持段落分隔', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        $getRoot().clear();
        const a = $createParagraphNode();
        a.append($createChipNode('r1', '镜头 1', 'AAA'));
        const b = $createParagraphNode();
        b.append($createTextNode('然后接上'));
        $getRoot().append(a);
        $getRoot().append(b);
      },
      { discrete: true },
    );
    const text = editor.getEditorState().read(() => resolveComposed(readComposed()));
    expect(text).toBe('AAA\n\n然后接上');
  });
});
