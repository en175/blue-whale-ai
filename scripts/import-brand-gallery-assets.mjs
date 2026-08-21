#!/usr/bin/env node
/* ============================================
 * 一次性：品牌素材（视频库图库）→ 首页模板画廊入库（IKA64P）
 * 环境变量：
 *   BLUEWHALE_API_BASE  后端基址（默认 http://localhost:3000）
 *   BLUEWHALE_ADMIN_TOKEN  管理端 Bearer token
 *     （浏览器登录后台后控制台：JSON.parse(localStorage.getItem('bw-auth')).state.accessToken）
 *   BRAND_GALLERY_ROOT  素材根目录（默认 E:\IDEA_Programme\new\品牌素材\视频库图库）
 * 用法：node scripts/import-brand-gallery-assets.mjs --dry-run   仅校验文件与打印计划
 *       node scripts/import-brand-gallery-assets.mjs            实际入库（同标题卡片跳过，幂等）
 * ============================================ */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.BLUEWHALE_API_BASE ?? 'http://localhost:3000';
const TOKEN = process.env.BLUEWHALE_ADMIN_TOKEN ?? '';
const ROOT = process.env.BRAND_GALLERY_ROOT ?? 'E:\\IDEA_Programme\\new\\品牌素材\\视频库图库';
const DRY_RUN = process.argv.includes('--dry-run');

async function api(method, p, body) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success !== true) {
    throw new Error(`${method} ${p} 失败（${res.status}）: ${json?.message ?? json?.msg ?? res.statusText}`);
  }
  return json.data;
}

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4' };

/** 三步上传：presign → PUT 直传 TOS → complete 得公网 URL */
async function uploadMedia(file) {
  const buf = await readFile(file);
  const ext = path.extname(file).toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new Error(`不支持的资产格式: ${file}`);
  const type = mime === 'video/mp4' ? 'video' : 'image';
  const presign = await api('POST', '/api/admin/templates/uploads/presign', { type, mime, size: buf.length });
  const put = await fetch(presign.upload_url, { method: 'PUT', headers: presign.headers, body: buf });
  if (!put.ok) throw new Error(`直传失败（HTTP ${put.status}）: ${file}`);
  const done = await api('POST', '/api/admin/templates/uploads/complete', {
    type, mime, size: buf.length, storage_key: presign.storage_key,
  });
  return done.url;
}

/** 提取 md 的「完整提示词」+「负面要求」两节正文 */
function extractPrompt(md) {
  const pick = (title) => {
    const m = md.match(new RegExp(`##\\s*${title}[\\s\\S]*?\\n([\\s\\S]*?)(?=\\n##\\s|$)`));
    return m ? m[1].trim() : '';
  };
  return [pick('完整提示词'), pick('负面要求')].filter(Boolean).join('\n\n');
}

/** 图片卡构造器：title=文件夹-编号，content 默认 文件夹-提示词-编号.md */
const pic = (folder, n, files, contentFile) => ({
  tag: 'picture',
  title: `${folder}-${n}`,
  content: `图片/${folder}/${contentFile ?? `${folder}-提示词-${n}.md`}`,
  images: files.map((f) => `图片/${folder}/${f}`),
});

/** manifest：25 卡（视频 8 + 图片 17），images 顺序即展示序 */
const manifest = [
  // ── 视频标签：一文件夹一卡 ──
  { tag: 'video', title: '3c-键盘', content: '视频/3c-键盘/3c-键盘-提示词.md', images: ['视频/3c-键盘/3c-键盘-参考图-01.jpg', '视频/3c-键盘/3c-键盘-参考图-02.jpeg', '视频/3c-键盘/3c-键盘-参考图-03.jpeg'], video: '视频/3c-键盘/3c-键盘-视频.mp4' },
  { tag: 'video', title: '小红书-香薰', content: '视频/小红书-香薰/小红书-香薰-提示词.md', images: ['视频/小红书-香薰/小红书-香薰-参考图-01.jpg', '视频/小红书-香薰/小红书-香薰-参考图-02.jpg', '视频/小红书-香薰/小红书-香薰-参考图-03.jpg'], video: '视频/小红书-香薰/小红书-香薰-视频.mp4' },
  { tag: 'video', title: '抖音千川-端午礼盒', content: '视频/抖音千川-端午礼盒/抖音千川-端午礼盒-提示词.md', images: ['视频/抖音千川-端午礼盒/抖音千川-端午礼盒-参考图-01.jpg', '视频/抖音千川-端午礼盒/抖音千川-端午礼盒-参考图-02.jpg', '视频/抖音千川-端午礼盒/抖音千川-端午礼盒-参考图-03.jpg'], video: '视频/抖音千川-端午礼盒/抖音千川-端午礼盒-视频.mp4' },
  { tag: 'video', title: '服装-睡衣', content: '视频/服装-睡衣/服装-睡衣-提示词.md', images: ['视频/服装-睡衣/服装-睡衣-参考图-01.jpg', '视频/服装-睡衣/服装-睡衣-参考图-02.jpg', '视频/服装-睡衣/服装-睡衣-参考图-03.jpeg'], video: '视频/服装-睡衣/服装-睡衣-视频.mp4' },
  { tag: 'video', title: '本地生活-牙医院团购', content: '视频/本地生活-牙医院团购/本地生活-牙医院团购-提示词.md', images: ['视频/本地生活-牙医院团购/本地生活-牙医院团购-参考图-01.jpg', '视频/本地生活-牙医院团购/本地生活-牙医院团购-参考图-02.jpg', '视频/本地生活-牙医院团购/本地生活-牙医院团购-参考图-03.jpg'], video: '视频/本地生活-牙医院团购/本地生活-牙医院团购-视频.mp4' },
  { tag: 'video', title: '美妆-香水', content: '视频/美妆-香水/美妆-香水-提示词.md', images: ['视频/美妆-香水/美妆-香水-参考图-01.png', '视频/美妆-香水/美妆-香水-参考图-02.jpg', '视频/美妆-香水/美妆-香水-参考图-03.jpg', '视频/美妆-香水/美妆-香水-参考图-04.jpg'], video: '视频/美妆-香水/美妆-香水-视频.mp4' },
  { tag: 'video', title: '腾讯视频号-黄桃', content: '视频/腾讯视频号-黄桃/腾讯视频号-黄桃-提示词.md', images: ['视频/腾讯视频号-黄桃/腾讯视频号-黄桃-封面-01-人物手持黄桃.jpg', '视频/腾讯视频号-黄桃/腾讯视频号-黄桃-封面-02-盘中黄桃静物.jpg', '视频/腾讯视频号-黄桃/腾讯视频号-黄桃-封面-03-近景展示黄桃.jpg'], video: '视频/腾讯视频号-黄桃/腾讯视频号-黄桃-视频.mp4' },
  { tag: 'video', title: '食物-塔可', content: '视频/食物-塔可/食物-塔可-提示词.md', images: ['视频/食物-塔可/食物-塔可-参考图-01.png', '视频/食物-塔可/食物-塔可-参考图-02.jpg', '视频/食物-塔可/食物-塔可-参考图-03.jpg'], video: '视频/食物-塔可/食物-塔可-视频.mp4' },
  // ── 图片标签：一提示词一卡 ──
  pic('YouTube缩略图', '01', ['YouTube缩略图-参考图-01.jpeg']),
  pic('YouTube缩略图', '02', ['YouTube缩略图-参考图-02.jpeg']),
  pic('YouTube缩略图', '03', ['YouTube缩略图-参考图-03.jpeg']),
  pic('为这款产品设计包装', '01', ['为这款产品设计包装-商品图.jpeg', '为这款产品设计包装-参考图-01.jpeg']),
  pic('为这款产品设计包装', '02', ['为这款产品设计包装-商品图.jpeg', '为这款产品设计包装-参考图-02.jpeg']),
  pic('为这款产品设计包装', '03', ['为这款产品设计包装-商品图.jpeg', '为这款产品设计包装-参考图-03.jpeg']),
  pic('创作现代品牌logo', '01', ['创作现代品牌logo-参考图-01.jpeg']),
  pic('创作现代品牌logo', '02', ['创作现代品牌logo-参考图-02.jpeg']),
  pic('创作现代品牌logo', '03', ['创作现代品牌logo-参考图-03.jpeg']),
  pic('商品详情页', '01', ['商品详情页-手表商品图.jpeg', '商品详情页-详情页-01.jpeg']),
  pic('商品详情页', '02', ['商品详情页-手表商品图.jpeg', '商品详情页-详情页-02.jpeg']),
  pic('商品详情页', '03', ['商品详情页-手表商品图.jpeg', '商品详情页-详情页-03.jpeg']),
  pic('营销活动海报', '01', ['营销活动海报-01.jpeg']),
  pic('营销活动海报', '02', ['营销活动海报-02.jpeg']),
  pic('营销活动海报', '03', ['营销活动海报-03.jpeg']),
  pic('高级产品主图-石斛原浆', '商品', ['高级产品主图-石斛原浆-商品原图.jpeg', '高级产品主图-石斛原浆-产品图-01.jpeg'], '高级产品主图-石斛原浆-商品提示词.md'),
  pic('高级产品主图-石斛原浆', '01', ['高级产品主图-石斛原浆-商品原图.jpeg', '高级产品主图-石斛原浆-产品图-02.jpeg', '高级产品主图-石斛原浆-产品图-03.jpeg'], '高级产品主图-石斛原浆-提示词-01.md'),
];

// sort_order：manifest 顺序按标签内 0..N-1 预排（重跑跳过不影响既有排序）
{
  const counter = {};
  for (const c of manifest) {
    c.sort_order = counter[c.tag] ?? 0;
    counter[c.tag] = c.sort_order + 1;
  }
}

async function main() {
  if (!DRY_RUN && !TOKEN) {
    console.error("缺少 BLUEWHALE_ADMIN_TOKEN。获取：浏览器登录后台后控制台执行 JSON.parse(localStorage.getItem('bw-auth')).state.accessToken");
    process.exit(1);
  }
  const existing = DRY_RUN ? [] : await api('GET', '/api/admin/templates');
  const existingKeys = new Set(existing.map((c) => `${c.tag_code}|${c.title}`));

  for (const card of manifest) {
    const files = [...card.images, ...(card.video ? [card.video] : [])];
    for (const f of files) await stat(path.join(ROOT, f)); // 文件缺失即抛错中断
    const content = extractPrompt(await readFile(path.join(ROOT, card.content), 'utf8'));
    if (!content) throw new Error(`提示词提取为空: ${card.content}`);

    if (existingKeys.has(`${card.tag}|${card.title}`)) {
      console.log(`跳过（已存在）: ${card.title}`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`[dry-run] ${card.tag} | sort=${card.sort_order} | ${card.title} | 图 ${card.images.length} | 视频 ${card.video ? '有' : '无'} | 提示词 ${content.length} 字`);
      continue;
    }
    const payload = {
      title: card.title,
      tag_code: card.tag,
      layout: 'wide',
      sort_order: card.sort_order,
      content,
      images: [],
    };
    for (const f of card.images) payload.images.push({ image_url: await uploadMedia(path.join(ROOT, f)) });
    if (card.video) payload.video_url = await uploadMedia(path.join(ROOT, card.video));
    const created = await api('POST', '/api/admin/templates', payload);
    console.log(`已入库: ${card.title} (id=${created.id})`);
  }
  console.log(DRY_RUN ? 'dry-run 完成，未写入。' : '入库完成。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
