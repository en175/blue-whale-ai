#!/usr/bin/env node
import { readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BLUEWHALE_API_BASE ?? 'http://localhost:3000';
const TOKEN = process.env.BLUEWHALE_ADMIN_TOKEN ?? '';
const ROOT = process.env.BRAND_GALLERY_ROOT ?? 'E:\\IDEA_Programme\\new\\品牌素材\\视频库图库（最终版）';
const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_BIN ?? 'ffprobe';
const DRY_RUN = process.argv.includes('--dry-run');
const ROLLBACK_FILE = process.env.BLUEWHALE_ROLLBACK_FILE ?? path.join(SCRIPT_DIR, '.rollback-final-full.json');

async function api(method, p, body) {
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
    if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < 4) {
      console.log(`API ${p} ${res.status}（第 ${attempt} 次），3s 后重试…`);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    throw new Error(`${method} ${p} 失败（${res.status}）: ${json?.error ?? json?.message ?? json?.msg ?? res.statusText}`);
  }
  throw lastErr ?? new Error(`API ${p} 失败`);
}

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4' };

async function presignUpload(file) {
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

function compress(src, out) {
  const r = spawnSync(FFMPEG, ['-y', '-v', 'error', '-i', src, '-c:v', 'libx264', '-crf', '27', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg 失败: ${r.stderr}`);
}

function topLevelOrder(buf) {
  const types = [];
  let pos = 0;
  while (pos + 8 <= buf.length) {
    const size = buf.readUInt32BE(pos);
    types.push(buf.toString('ascii', pos + 4, pos + 8));
    if (size === 1) pos += Number(buf.readBigUInt64BE(pos + 8));
    else if (size === 0) break;
    else pos += size;
  }
  return types;
}

async function verify(out) {
  const st = await stat(out);
  const probe = spawnSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out], { encoding: 'utf8' });
  if (probe.status !== 0) throw new Error(`ffprobe 失败: ${probe.stderr}`);
  const [w, h] = probe.stdout.trim().split(',').map(Number);
  if (!w || !h) throw new Error(`分辨率解析失败: ${out}`);
  const order = topLevelOrder(await readFile(out));
  if (order.indexOf('moov') > order.indexOf('mdat')) throw new Error('moov 未在首（faststart 未生效）');
  return { w, h, size: st.size };
}

const MANIFEST = [
  { tag: 'video', title: '3c-键盘', images: ['视频/3c-键盘/3c-键盘-封面-01.png', '视频/3c-键盘/3c-键盘-封面-02.png', '视频/3c-键盘/3c-键盘-封面-03.png'], video: '视频/3c-键盘/3c-键盘-视频-01.mp4', content: '视频/3c-键盘/3c-键盘-提示词.md' },
  { tag: 'video', title: '小红书-香薰', images: ['视频/小红书-香薰/小红书-香薰-封面-01.png', '视频/小红书-香薰/小红书-香薰-封面-02.png', '视频/小红书-香薰/小红书-香薰-封面-03.png'], video: '视频/小红书-香薰/小红书-香薰-视频-01.mp4', content: '视频/小红书-香薰/小红书-香薰-提示词.md' },
  { tag: 'video', title: '抖音千川-中秋礼盒', images: ['视频/抖音千川-中秋礼盒/抖音千川-中秋礼盒-封面-01.png', '视频/抖音千川-中秋礼盒/抖音千川-中秋礼盒-封面-02.png', '视频/抖音千川-中秋礼盒/抖音千川-中秋礼盒-封面-03.png'], video: '视频/抖音千川-中秋礼盒/抖音千川-中秋礼盒-视频-01.mp4', content: '视频/抖音千川-中秋礼盒/抖音千川-中秋礼盒-提示词.md' },
  { tag: 'video', title: '服装-睡衣', images: ['视频/服装-睡衣/服装-睡衣-封面-01.png', '视频/服装-睡衣/服装-睡衣-封面-02.png', '视频/服装-睡衣/服装-睡衣-封面-03.png'], video: '视频/服装-睡衣/服装-睡衣-视频-01.mp4', content: '视频/服装-睡衣/服装-睡衣-提示词.md' },
  { tag: 'video', title: '本地生活-牙医院团购', images: ['视频/本地生活-牙医院团购/本地生活-牙医院团购-封面-01.png', '视频/本地生活-牙医院团购/本地生活-牙医院团购-封面-02.png', '视频/本地生活-牙医院团购/本地生活-牙医院团购-封面-03.png'], video: '视频/本地生活-牙医院团购/本地生活-牙医院团购-视频-01.mp4', content: '视频/本地生活-牙医院团购/本地生活-牙医院团购-提示词.md' },
  { tag: 'video', title: '美妆-香水', images: ['视频/美妆-香水/美妆-香水-封面-01.png', '视频/美妆-香水/美妆-香水-封面-02.png', '视频/美妆-香水/美妆-香水-封面-03.png'], video: '视频/美妆-香水/美妆-香水-视频-01.mp4', content: '视频/美妆-香水/美妆-香水-提示词.md' },
  { tag: 'video', title: '腾讯视频号-黄桃', images: ['视频/腾讯视频号-黄桃/腾讯视频号-黄桃-封面-01.png', '视频/腾讯视频号-黄桃/腾讯视频号-黄桃-封面-02.png', '视频/腾讯视频号-黄桃/腾讯视频号-黄桃-封面-03.png'], video: '视频/腾讯视频号-黄桃/腾讯视频号-黄桃-视频-01.mp4', content: '视频/腾讯视频号-黄桃/腾讯视频号-黄桃-提示词.md' },
  { tag: 'video', title: '食物-塔可', images: ['视频/食物-塔可/食物-塔可-封面-01.png', '视频/食物-塔可/食物-塔可-封面-02.png', '视频/食物-塔可/食物-塔可-封面-03.png'], video: '视频/食物-塔可/食物-塔可-视频-01.mp4', content: '视频/食物-塔可/食物-塔可-提示词.md' },
  { tag: 'picture', title: 'YouTube缩略图', images: ['图片/YouTube缩略图/YouTube缩略图-成图-01.png', '图片/YouTube缩略图/YouTube缩略图-参考图-01.jpg', '图片/YouTube缩略图/YouTube缩略图-参考图-02.jpg'], content: '图片/YouTube缩略图/YouTube缩略图-提示词-01.md' },
  { tag: 'picture', title: '为这款产品设计包装', images: ['图片/为这款产品设计包装/为这款产品设计包装-成图-01.png', '图片/为这款产品设计包装/为这款产品设计包装-成图-02.png', '图片/为这款产品设计包装/为这款产品设计包装-成图-03.png'], content: '图片/为这款产品设计包装/为这款产品设计包装-提示词-01.md' },
  { tag: 'picture', title: '创作现代品牌logo', images: ['图片/创作现代品牌logo/创作现代品牌logo-参考图-01.jpeg', '图片/创作现代品牌logo/创作现代品牌logo-参考图-02.jpeg', '图片/创作现代品牌logo/创作现代品牌logo-参考图-03.jpeg'], content: '图片/创作现代品牌logo/创作现代品牌logo-提示词-01.md' },
  { tag: 'picture', title: '商品详情页', images: ['图片/商品详情页/商品详情页-成图-01.png', '图片/商品详情页/商品详情页-成图-02.png', '图片/商品详情页/商品详情页-成图-03.png'], content: '图片/商品详情页/商品详情页-提示词-01.md' },
  { tag: 'picture', title: '营销活动海报', images: ['图片/营销活动海报/营销活动海报-成图-01.png', '图片/营销活动海报/营销活动海报-成图-02.png', '图片/营销活动海报/营销活动海报-成图-03.png'], content: '图片/营销活动海报/营销活动海报-提示词-01.md' },
  { tag: 'picture', title: '高级产品主图-石斛原浆', images: ['图片/高级产品主图-石斛原浆/高级产品主图-石斛原浆-成图-01.png', '图片/高级产品主图-石斛原浆/高级产品主图-石斛原浆-成图-02.png', '图片/高级产品主图-石斛原浆/高级产品主图-石斛原浆-产品图-01.jpg'], content: '图片/高级产品主图-石斛原浆/高级产品主图-石斛原浆-提示词-01.md' },
];

async function main() {
  if (!TOKEN) { console.error('缺少 BLUEWHALE_ADMIN_TOKEN'); process.exit(1); }
  const cards = await api('GET', '/api/admin/templates');
  const byTitle = new Map(cards.filter((c) => c.tag_code === 'video' || c.tag_code === 'picture').map((c) => [c.title, c]));
  const rollback = existsSync(ROLLBACK_FILE) ? JSON.parse(readFileSync(ROLLBACK_FILE, 'utf8')) : {};

  for (const card of MANIFEST) {
    const existing = byTitle.get(card.title);
    if (!existing) { console.warn(`⚠️ 未找到卡: ${card.title}（跳过）`); continue; }

    const srcFiles = [...card.images, ...(card.video ? [card.video] : [])];
    for (const f of srcFiles) await stat(path.join(ROOT, f));
    const content = (await readFile(path.join(ROOT, card.content), 'utf8')).trim();
    if (!content) throw new Error(`提示词为空: ${card.content}`);

    if (rollback[card.title]) {
      console.log(`跳过（已处理）: ${card.title}`);
      continue;
    }

    let videoOut = null;
    if (card.video) {
      videoOut = path.join(tmpdir(), `bw-final-${randomUUID()}.mp4`);
      compress(path.join(ROOT, card.video), videoOut);
      const { w, h, size } = await verify(videoOut);
      console.log(`重压: ${card.title} → ${(size / 1024 / 1024).toFixed(2)}MB @ ${w}x${h}`);
    }

    console.log(`计划: ${card.tag} | ${card.title} | 图 ${card.images.length} | 视频 ${card.video ? '有' : '无'} | 提示词 ${content.length} 字`);
    if (DRY_RUN) continue;

    const newImages = [];
    for (const f of card.images) newImages.push({ image_url: await presignUpload(path.join(ROOT, f)) });
    let newVideoUrl = undefined;
    if (videoOut) newVideoUrl = await presignUpload(videoOut);

    const old = {
      video_url: existing.video_url ?? null,
      images: existing.images.map((i) => i.image_url),
      content: existing.content ?? null,
    };
    await api('PUT', `/api/admin/templates/${existing.id}`, {
      title: card.title,
      tag_code: card.tag,
      layout: existing.layout,
      sort_order: existing.sort_order,
      content,
      ...(newVideoUrl ? { video_url: newVideoUrl } : {}),
      images: newImages,
    });
    rollback[card.title] = {
      old,
      new: {
        video_url: newVideoUrl ?? existing.video_url ?? null,
        images: newImages.map((i) => i.image_url),
        content,
      },
    };
    await writeFile(ROLLBACK_FILE, JSON.stringify(rollback, null, 2), 'utf8');
    console.log(`已替换: ${card.title} (id=${existing.id})`);
  }
  if (!DRY_RUN) console.log(`回退清单: ${ROLLBACK_FILE}`);
  console.log(DRY_RUN ? 'dry-run 完成，未上传未更新。' : '最终版全量替换完成。');
}

main().catch((e) => { console.error(e); process.exit(1); });
