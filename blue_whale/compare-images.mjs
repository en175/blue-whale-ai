import sharp from "sharp";

const [aPath, bPath, outPath] = process.argv.slice(2);

async function load(path) {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, info };
}

const a = await load(aPath);
const b = await load(bPath);

if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
  console.log("sizes differ", a.info, b.info);
  process.exit(1);
}

const w = a.info.width;
const h = a.info.height;
const diff = Buffer.alloc(w * h * 4);
let changed = 0;
for (let i = 0; i < w * h; i++) {
  const ai = i * 4;
  const bi = i * 4;
  const dr = Math.abs(a.data[ai] - b.data[bi]);
  const dg = Math.abs(a.data[ai + 1] - b.data[bi + 1]);
  const db = Math.abs(a.data[ai + 2] - b.data[bi + 2]);
  const da = Math.abs(a.data[ai + 3] - b.data[bi + 3]);
  if (dr + dg + db + da > 10) {
    changed++;
    diff[ai] = 255;
    diff[ai + 1] = 0;
    diff[ai + 2] = 0;
    diff[ai + 3] = 255;
  } else {
    diff[ai] = a.data[ai];
    diff[ai + 1] = a.data[ai + 1];
    diff[ai + 2] = a.data[ai + 2];
    diff[ai + 3] = a.data[ai + 3];
  }
}
console.log({ width: w, height: h, changed, total: w * h, pct: ((changed / (w * h)) * 100).toFixed(2) + "%" });

if (outPath) {
  await sharp(diff, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toFile(outPath);
  console.log("saved", outPath);
}
