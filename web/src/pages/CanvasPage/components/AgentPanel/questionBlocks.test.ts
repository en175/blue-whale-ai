/**
 * 追问认题（IKFLB9 定稿「排版一」）：三种真实写法都要认得出，认不出的照旧当 markdown。
 * 样本取自本地会话 ses_76de1ab1 与一场三视图会话落库的回复。
 */
import { describe, expect, it } from 'vitest';
import { splitReplySegments } from './questionBlocks';

const grilling = `我先把这次的创作方向跟你对一下。目标基本清楚，还差几个判断需要你拍板。

---

**❓ Q1 — 视角与构图**：从什么角度看这个镇？

- **A. 港口平视**：从海面方向看小镇，灯塔在画面里明显高出一截。
- **B. 小镇仰视望向海**：从镇子边缘的低处望向海岸。
- **C. 半空俯瞰**：从略高于屋顶的视角看。
- **D. 对岸远眺**：从海湾对面把整个镇子收在画面里。

➡️ **推荐 C（半空俯瞰）**：这种角度最容易把"彩色屋顶群"和"灯塔"同时立住。

---

**❓ Q2 — 一天里的什么时刻 / 光线**：

- **A. 金色清晨**：光线偏暖橙。
- **B. 晴朗正午**：天蓝海蓝。

➡️ **推荐 B（晴朗正午）**：你说"温暖明亮"。

---

如果上面两题你都同意，最省事的回法是：**"都按你推荐的来"**。`;

describe('splitReplySegments', () => {
  it('grilling 的题：题头拆出编号、标题、问句；选项拆出字母、名字、说明；推荐单独一段；题间的 --- 不再出现', () => {
    const segs = splitReplySegments(grilling);
    expect(segs.map((s) => s.kind)).toEqual(['markdown', 'question', 'question', 'markdown']);
    expect(segs[0]).toMatchObject({ kind: 'markdown', text: '我先把这次的创作方向跟你对一下。目标基本清楚，还差几个判断需要你拍板。' });
    expect(segs[1]).toMatchObject({
      kind: 'question',
      no: 'Q1',
      title: '视角与构图',
      ask: '从什么角度看这个镇？',
      body: '',
      recommendation: '**推荐 C（半空俯瞰）**：这种角度最容易把"彩色屋顶群"和"灯塔"同时立住。',
    });
    const q1 = segs[1] as Extract<(typeof segs)[number], { kind: 'question' }>;
    expect(q1.options).toEqual([
      { key: 'A', label: '港口平视', desc: '从海面方向看小镇，灯塔在画面里明显高出一截。' },
      { key: 'B', label: '小镇仰视望向海', desc: '从镇子边缘的低处望向海岸。' },
      { key: 'C', label: '半空俯瞰', desc: '从略高于屋顶的视角看。' },
      { key: 'D', label: '对岸远眺', desc: '从海湾对面把整个镇子收在画面里。' },
    ]);
    expect(segs[2]).toMatchObject({ kind: 'question', no: 'Q2', title: '一天里的什么时刻 / 光线', ask: '' });
    expect(segs[3]).toMatchObject({ kind: 'markdown', text: '如果上面两题你都同意，最省事的回法是：**"都按你推荐的来"**。' });
  });

  it('没有选项、推荐后还跟着几段的题：正文归题身，➡️ 之后全归推荐', () => {
    const segs = splitReplySegments(`❓ **Q1 — 人物参考是个真人**

参考图里是一个真实的人。我不能原样照搬这张脸。

➡️ **建议：做一个"受这个人物启发"的新角色**——保留短黑发。

如果你确实已经获得本人授权，告诉我。

---

❓ **Q3 — 三张脸怎么排**

➡️ **建议：一张图里横排三个角度**。`);
    expect(segs.map((s) => s.kind)).toEqual(['question', 'question']);
    expect(segs[0]).toMatchObject({
      no: 'Q1',
      title: '人物参考是个真人',
      body: '参考图里是一个真实的人。我不能原样照搬这张脸。',
      options: [],
      recommendation: '**建议：做一个"受这个人物启发"的新角色**——保留短黑发。\n\n如果你确实已经获得本人授权，告诉我。',
    });
    expect(segs[1]).toMatchObject({ no: 'Q3', title: '三张脸怎么排', body: '', recommendation: '**建议：一张图里横排三个角度**。' });
  });

  it('服务端写的模型题没有编号；推荐下面的「也可以选」列表归推荐', () => {
    const segs = splitReplySegments(`好，那我现在把模型路线这道题交出来让你点一下。

❓ **用哪个模型出片**

➡️ 推荐 **Seedream 4.5**：单张水彩风格插画。
- 也可以选 **GPT Image 2**：在风格化插画上更灵活。`);
    expect(segs.map((s) => s.kind)).toEqual(['markdown', 'question']);
    expect(segs[1]).toMatchObject({
      no: null,
      title: '用哪个模型出片',
      options: [],
      recommendation: '推荐 **Seedream 4.5**：单张水彩风格插画。\n- 也可以选 **GPT Image 2**：在风格化插画上更灵活。',
    });
  });

  it('模型不编字母、只是一条条列出来的选项也认成选项，字母留空（项目 607）', () => {
    const segs = splitReplySegments(`**❓ Q1 — 用途与尺寸**：这张图你打算用在哪？

- 通用桌面壁纸（横版 16:9，细节丰富）
- 手机壁纸 / 锁屏（竖版 9:16，纵向构图）
- 还没定，先做一张好看的

**➡️ 推荐：通用桌面壁纸，16:9 横版**。夏日小镇横向展开最舒服。`);
    expect(segs[0]).toMatchObject({
      kind: 'question',
      no: 'Q1',
      title: '用途与尺寸',
      options: [
        { key: '', label: '通用桌面壁纸（横版 16:9，细节丰富）', desc: '' },
        { key: '', label: '手机壁纸 / 锁屏（竖版 9:16，纵向构图）', desc: '' },
        { key: '', label: '还没定，先做一张好看的', desc: '' },
      ],
      // 箭头前的 ** 剥掉，配对的那个也剥掉，剩下的正文不再有落单的星号。
      recommendation: '推荐：通用桌面壁纸，16:9 横版。夏日小镇横向展开最舒服。',
    });
  });

  it('没有题的正文原样一段 markdown', () => {
    expect(splitReplySegments('卡写好了。\n\n- 一\n- 二')).toEqual([{ kind: 'markdown', text: '卡写好了。\n\n- 一\n- 二' }]);
  });
});
