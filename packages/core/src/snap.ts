// SPDX-License-Identifier: MIT
// The side-effecting core of L0013: render a task's form view in headless Chrome, crop it to
// a fixed aspect (top crop), upload the PNG to an item-derived Firebase Storage path, and
// return the public URL + base64. Heavy, node-only deps (puppeteer / sharp / firebase-admin)
// are imported lazily here so that merely importing the compiler (e.g. build-static) does not
// pull them in.

const API_URL = process.env.GRAFFITICODE_API_URL || "https://api.graffiticode.org";
const STORAGE_BUCKET = process.env.THUMBNAIL_BUCKET || "graffiticode.appspot.com";

// Capture viewport + default crop. The form renders at VIEWPORT_W; we keep the top 4:3.
const VIEWPORT_W = 1024;
const VIEWPORT_H = 768;
const ASPECT = 4 / 3; // width : height
const DEFAULT_OUTPUT_W = 480;
const SETTLE_MS = 1500; // let the form paint / post its first data-updated

export interface SnapCrop {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface SnapArgs {
  task: string;
  lang: string;
  item?: string;
  crop?: SnapCrop;
  width?: number;
  token?: string;
}

export interface SnapResult {
  image: string; // alias of `url` — the key the L0013 form view renders
  url: string; // public CDN URL of the uploaded PNG
  png: string; // base64-encoded PNG
  item: string; // the id the URL was derived from
}

function buildFormUrl({ lang, task, token }: { lang: string; task: string; token?: string }) {
  const params = new URLSearchParams();
  params.set("lang", String(lang));
  params.set("id", String(task));
  if (token) params.set("access_token", String(token));
  return `${API_URL}/form?${params.toString()}`;
}

let _bucket: any = null;
async function getBucket() {
  if (_bucket) return _bucket;
  const admin: any = (await import("firebase-admin")).default;
  if (!admin.apps || admin.apps.length === 0) {
    // Uses Application Default Credentials (the Cloud Run service account locally via
    // GOOGLE_APPLICATION_CREDENTIALS).
    admin.initializeApp({ storageBucket: STORAGE_BUCKET });
  }
  _bucket = admin.storage().bucket(STORAGE_BUCKET);
  return _bucket;
}

async function upload(itemId: string, buffer: Buffer): Promise<string> {
  const bucket = await getBucket();
  const safe = String(itemId).replace(/[^A-Za-z0-9_-]/g, "_");
  const objectPath = `thumbnails/${safe}.png`;
  const file = bucket.file(objectPath);
  await file.save(buffer, {
    resumable: false,
    contentType: "image/png",
    metadata: { cacheControl: "public, max-age=31536000" },
  });
  await file.makePublic();
  return `https://storage.googleapis.com/${STORAGE_BUCKET}/${objectPath}`;
}

export async function snap(args: SnapArgs): Promise<SnapResult> {
  const { task, lang, item, crop, width = DEFAULT_OUTPUT_W, token } = args;
  if (!task) throw new Error("snap: `task` is required");
  if (!lang) throw new Error("snap: `lang` is required");
  const itemId = item || task;
  const url = buildFormUrl({ lang, task, token });

  const puppeteer: any = (await import("puppeteer")).default;
  const sharp: any = (await import("sharp")).default;

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: VIEWPORT_W, height: VIEWPORT_H, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, SETTLE_MS));

    // Fixed-aspect top crop. Default: full width, height = width / (4:3), anchored at the top.
    const clip = {
      x: crop?.x ?? 0,
      y: crop?.y ?? 0,
      width: crop?.width ?? VIEWPORT_W,
      height: crop?.height ?? Math.round(VIEWPORT_W / ASPECT),
    };
    const shot = (await page.screenshot({ type: "png", clip })) as Buffer;

    const outW = Math.max(1, Math.round(width));
    const outH = Math.round((outW * clip.height) / clip.width);
    const png: Buffer = await sharp(shot)
      .resize(outW, outH, { fit: "cover", position: "top" })
      .png()
      .toBuffer();

    const publicUrl = await upload(itemId, png);
    return { image: publicUrl, url: publicUrl, png: png.toString("base64"), item: itemId };
  } finally {
    await browser.close();
  }
}
