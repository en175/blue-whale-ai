#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const BASE = process.env.BLUEWHALE_API_BASE ?? 'http://localhost:3000';
const TOKEN = process.env.BLUEWHALE_ADMIN_TOKEN ?? '';
const ROOT = process.env.BRAND_GALLERY_ROOT ?? 'E:\\IDEA_Programme\\new\\品牌素材\\视频库图库';
const DRY_RUN = process.argv.includes('--dry-run');

async function api(method, p, body, opts = {}) {
  const retry503 = opts.retry503 !== false;
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    let res;
    try {
      res = await fetch(`${BASE}${p}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      lastErr = e;
      if (attempt < 4) { console.log(`API ${p} 网络失败（第 ${attempt} 次），3s 后重试…`); await new Promise((r) => setTimeout(r, 3000)); continue; }
      throw e;
    }
    const json = await res.json().catch(() => null);
    if (res.ok && json?.success === true) return json.data;
    const transient = res.status === 502 || res.status === 504 || (res.status === 503 && retry503);
    if (transient && attempt < 4) {
      console.log(`API ${p} ${res.status}（第 ${attempt} 次），3s 后重试…`);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    throw new Error(`${method} ${p} 失败（${res.status}）: ${json?.message ?? json?.msg ?? res.statusText}`);
  }
  throw lastErr ?? new Error(`API ${p} 失败`);
}

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4' };

function loadTosConfig() {
  const vars = {};
  try {
    for (const line of readFileSync(path.join(SCRIPT_DIR, '..', '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
      if (m) vars[m[1]] = m[2];
    }
  } catch {  }
  const get = (k) => process.env[k] ?? vars[k];
  const cfg = {
    accessKeyId: get('VOLC_ACCESS_KEY_ID'),
    secretAccessKey: get('VOLC_SECRET_ACCESS_KEY'),
    endpoint: (get('VOLC_TOS_ENDPOINT') ?? '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
    bucket: get('VOLC_TOS_BUCKET'),
    region: get('VOLC_TOS_REGION'),
  };
  return Object.values(cfg).every(Boolean) ? cfg : null;
}

let tosHandle = null;
function getTos() {
  if (tosHandle) return tosHandle;
  const cfg = loadTosConfig();
  if (!cfg) throw new Error('TOS 直连配置缺失：.env 与环境均无 VOLC_* 变量');
  const req = createRequire(path.join(SCRIPT_DIR, '..', 'backend', 'package.json'));
  const { TosClient } = req('@volcengine/tos-sdk');
  tosHandle = {
    cfg,
    client: new TosClient({
      accessKeyId: cfg.accessKeyId,
      accessKeySecret: cfg.secretAccessKey,
      endpoint: cfg.endpoint,
      region: cfg.region,
    }),
  };
  return tosHandle;
}

async function directUploadMedia(file) {
  const buf = await readFile(file);
  const ext = path.extname(file).toLowerCase();
  const mime = MIME[ext];
  const type = mime === 'video/mp4' ? 'video' : 'image';
  const { client, cfg } = getTos();
  const key = `admin/templates/${type}/${randomUUID().replace(/-/g, '')}${ext}`;
  const uploadUrl = await client.getPreSignedUrl({ bucket: cfg.bucket, key, method: 'PUT', expires: 600 });
  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': mime }, body: buf });
  if (!put.ok) throw new Error(`TOS 直传失败（HTTP ${put.status}）: ${file}`);
  await client.putObjectAcl({ bucket: cfg.bucket, key, acl: 'public-read' });
  return `https://${cfg.bucket}.${cfg.endpoint}/${key}`;
}

async function presignUploadMedia(file) {
  const buf = await readFile(file);
  const ext = path.extname(file).toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new Error(`不支持的资产格式: ${file}`);
  const type = mime === 'video/mp4' ? 'video' : 'image';
  const presign = await api('POST', '/api/admin/templates/uploads/presign', { type, mime, size: buf.length }, { retry503: false });
  const put = await fetch(presign.upload_url, { method: 'PUT', headers: presign.headers, body: buf });
  if (!put.ok) throw new Error(`直传失败（HTTP ${put.status}）: ${file}`);
  const done = await api('POST', '/api/admin/templates/uploads/complete', {
    type, mime, size: buf.length, storage_key: presign.storage_key,
  });
  return done.url;
}

async function uploadMedia(file) {
  try {
    return await presignUploadMedia(file);
  } catch (e) {
    if (!String(e?.message ?? '').includes('503')) throw e;
    console.log(`presign 503，降级 TOS 直连: ${path.basename(file)}`);
  }
  let lastErr;
  for (let i = 1; i <= 3; i++) {
    try {
      return await directUploadMedia(file);
    } catch (e) {
      lastErr = e;
      console.log(`直连第 ${i} 次失败（${e?.code ?? e?.message}），2s 后重试…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

function extractPrompt(md) {
  const pick = (title) => {
    const m = md.match(new RegExp(`##\\s*${title}[\\s\\S]*?\\n([\\s\\S]*?)(?=\\n##\\s|$)`));
    return m ? m[1].trim() : '';
  };
  return [pick('完整提示词'), pick('负面要求')].filter(Boolean).join('\n\n');
}

const picSet = (folder, files, contentFile) => ({
  tag: 'picture',
  title: folder,
  content: `图片/${folder}/${contentFile ?? `${folder}-提示词-01.md`}`,
  images: files.map((f) => `图片/${folder}/${f}`),
});

const manifest = [
  { tag: 'video', title: '3c-键盘', content: '视频/3c-键盘/3c-键盘-提示词.md', images: ['视频/3c-键盘/3c-键盘-参考图-01.jpg', '视频/3c-键盘/3c-键盘-参考图-02.jpeg', '视频/3c-键盘/3c-键盘-参考图-03.jpeg'], video: '视频/3c-键盘/3c-键盘-视频.mp4' },
  { tag: 'video', title: '小红书-香薰', content: '视频/小红书-香薰/小红书-香薰-提示词.md', images: ['视频/小红书-香薰/小红书-香薰-参考图-01.jpg', '视频/小红书-香薰/小红书-香薰-参考图-02.jpg', '视频/小红书-香薰/小红书-香薰-参考图-03.jpg'], video: '视频/小红书-香薰/小红书-香薰-视频.mp4' },
  { tag: 'video', title: '抖音千川-端午礼盒', content: '视频/抖音千川-端午礼盒/抖音千川-端午礼盒-提示词.md', images: ['视频/抖音千川-端午礼盒/抖音千川-端午礼盒-参考图-01.jpg', '视频/抖音千川-端午礼盒/抖音千川-端午礼盒-参考图-02.jpg', '视频/抖音千川-端午礼盒/抖音千川-端午礼盒-参考图-03.jpg'], video: '视频/抖音千川-端午礼盒/抖音千川-端午礼盒-视频.mp4' },
  { tag: 'video', title: '服装-睡衣', content: '视频/服装-睡衣/服装-睡衣-提示词.md', images: ['视频/服装-睡衣/服装-睡衣-参考图-01.jpg', '视频/服装-睡衣/服装-睡衣-参考图-02.jpg', '视频/服装-睡衣/服装-睡衣-参考图-03.jpeg'], video: '视频/服装-睡衣/服装-睡衣-视频.mp4' },
  { tag: 'video', title: '本地生活-牙医院团购', content: '视频/本地生活-牙医院团购/本地生活-牙医院团购-提示词.md', images: ['视频/本地生活-牙医院团购/本地生活-牙医院团购-参考图-01.jpg', '视频/本地生活-牙医院团购/本地生活-牙医院团购-参考图-02.jpg', '视频/本地生活-牙医院团购/本地生活-牙医院团购-参考图-03.jpg'], video: '视频/本地生活-牙医院团购/本地生活-牙医院团购-视频.mp4' },
  { tag: 'video', title: '美妆-香水', content: '视频/美妆-香水/美妆-香水-提示词.md', images: ['视频/美妆-香水/美妆-香水-参考图-01.png', '视频/美妆-香水/美妆-香水-参考图-02.jpg', '视频/美妆-香水/美妆-香水-参考图-03.jpg', '视频/美妆-香水/美妆-香水-参考图-04.jpg'], video: '视频/美妆-香水/美妆-香水-视频.mp4' },
  { tag: 'video', title: '腾讯视频号-黄桃', content: '视频/腾讯视频号-黄桃/腾讯视频号-黄桃-提示词.md', images: ['视频/腾讯视频号-黄桃/腾讯视频号-黄桃-封面-01-人物手持黄桃.jpg', '视频/腾讯视频号-黄桃/腾讯视频号-黄桃-封面-02-盘中黄桃静物.jpg', '视频/腾讯视频号-黄桃/腾讯视频号-黄桃-封面-03-近景展示黄桃.jpg'], video: '视频/腾讯视频号-黄桃/腾讯视频号-黄桃-视频.mp4' },
  { tag: 'video', title: '食物-塔可', content: '视频/食物-塔可/食物-塔可-提示词.md', images: ['视频/食物-塔可/食物-塔可-参考图-01.png', '视频/食物-塔可/食物-塔可-参考图-02.jpg', '视频/食物-塔可/食物-塔可-参考图-03.jpg'], video: '视频/食物-塔可/食物-塔可-视频.mp4' },
  picSet('YouTube缩略图', ['YouTube缩略图-参考图-01.jpeg', 'YouTube缩略图-参考图-02.jpeg', 'YouTube缩略图-参考图-03.jpeg']),
  picSet('为这款产品设计包装', ['为这款产品设计包装-参考图-01.jpeg', '为这款产品设计包装-参考图-02.jpeg', '为这款产品设计包装-参考图-03.jpeg']),
  picSet('创作现代品牌logo', ['创作现代品牌logo-参考图-01.jpeg', '创作现代品牌logo-参考图-02.jpeg', '创作现代品牌logo-参考图-03.jpeg']),
  picSet('商品详情页', ['商品详情页-详情页-01.jpeg', '商品详情页-详情页-02.jpeg', '商品详情页-详情页-03.jpeg']),
  picSet('营销活动海报', ['营销活动海报-01.jpeg', '营销活动海报-02.jpeg', '营销活动海报-03.jpeg']),
  picSet('高级产品主图-石斛原浆', ['高级产品主图-石斛原浆-产品图-01.jpeg', '高级产品主图-石斛原浆-产品图-02.jpeg', '高级产品主图-石斛原浆-产品图-03.jpeg']),
];

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

  if (!DRY_RUN) {
    const pictureTitles = new Set(manifest.filter((c) => c.tag === 'picture').map((c) => c.title));
    for (const c of existing.filter((x) => x.tag_code === 'picture' && !pictureTitles.has(x.title))) {
      await api('DELETE', `/api/admin/templates/${c.id}`);
      console.log(`软删旧卡: ${c.title}`);
    }
  }

  for (const card of manifest) {
    const files = [...card.images, ...(card.video ? [card.video] : [])];
    for (const f of files) await stat(path.join(ROOT, f));
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
