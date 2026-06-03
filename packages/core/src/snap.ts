// SPDX-License-Identifier: MIT
// The side-effecting core of L0013: render a task's form view in headless Chrome, crop it to
// a fixed aspect (top crop), upload the PNG to an item-derived Firebase Storage path, and
// return the public URL + base64. Heavy, node-only deps (puppeteer / sharp / firebase-admin)
// are imported lazily here so that merely importing the compiler (e.g. build-static) does not
// pull them in.

const API_URL = process.env.GRAFFITICODE_API_URL || "https://api.graffiticode.org";
// The app's item form route (`/form/{itemId}`) resolves an item id to its task + language and
// renders it — that's how `snap` gets the lang/task "from the item id" without a separate lookup.
const APP_URL = process.env.GRAFFITICODE_APP_URL || "https://app.graffiticode.org";
const STORAGE_BUCKET = process.env.THUMBNAIL_BUCKET || "graffiticode.appspot.com";

// Default viewport (the window the form lays out into) + default crop. Most form views fill the
// browser window, so the viewport bounds the layout before we capture; the default crop keeps
// the top 4:3 of that window. Both are author-overridable via the `viewport`/`crop` modifiers.
const VIEWPORT_W = 1024;
const VIEWPORT_H = 768;
const DEVICE_SCALE = 2;
const ASPECT = 4 / 3; // width : height
const DEFAULT_OUTPUT_W = 480;
const SETTLE_MS = 1500; // let the form paint / post its first data-updated

export interface SnapCrop {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface SnapViewport {
  width?: number;
  height?: number;
}

export interface SnapArgs {
  item: string; // the item id — its form view is rendered (task + lang resolved from it)
  task?: string; // optional explicit override (with `lang`) → render via the api form route
  lang?: string;
  viewport?: SnapViewport; // browser window the form lays out into (default 1024×768)
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

// Resolve an item id to its task id (and language) via the app's server-side resolver. This
// runs with admin Firestore access on the app side, so it works for public items with no token
// and for the owner's own (private) items when the owner's token is supplied — without ever
// loading the app's client-side sign-in shell.
async function resolveItem(
  item: string,
  token?: string,
): Promise<{ taskId: string; lang?: string }> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = String(token);
  const resolveUrl = `${APP_URL}/api/form/resolve?id=${encodeURIComponent(item)}`;
  const res = await fetch(resolveUrl, { headers });
  if (!res.ok) throw new Error(`could not resolve item ${item}: HTTP ${res.status} from ${resolveUrl}`);
  const body: any = await res.json();
  // The resolver echoes the input id as `taskId` when the item isn't found (fallthrough), so a
  // returned taskId equal to the item id means "not found here" (likely the wrong environment).
  const notFound = !body?.taskId || body.taskId === item;
  if (notFound) {
    throw new Error(
      `item ${item} not found at ${APP_URL} — wrong environment? Point GRAFFITICODE_APP_URL at where the item lives (e.g. http://localhost:3000 for local).`,
    );
  }
  if (body?.allowed === false) {
    throw new Error(
      `item ${item} resolved (task ${body.taskId}) but its task is not public and no valid owner token was supplied — set GC_SNAP_ACCESS_TOKEN to an owner token, or make the task public.`,
    );
  }
  return { taskId: String(body.taskId), lang: body.lang ? String(body.lang) : undefined };
}

// Render the BARE form via the api route (not the app route, which mounts a sign-in shell). A
// public task renders with no token; a private task renders when `token` is the owner's. `lang`
// is optional — the api form route derives it from the task.
function buildFormUrl({ taskId, lang, token }: { taskId: string; lang?: string; token?: string }) {
  const params = new URLSearchParams();
  params.set("id", String(taskId));
  if (lang) params.set("lang", String(lang));
  if (token) params.set("access_token", String(token));
  return `${API_URL}/form?${params.toString()}`;
}

// A dedicated, named Firebase app so we never collide with the default app the api server (and
// @graffiticode/auth) already initialize, and so our explicit credentials are always used. The
// init promise is memoized so concurrent compiles can't double-initialize.
const APP_NAME = "l0013-snap";
let _bucketPromise: Promise<any> | null = null;

async function initBucket() {
  const admin: any = (await import("firebase-admin")).default;
  const opts: any = { storageBucket: STORAGE_BUCKET };
  // On Cloud Run, Application Default Credentials (the service account) are used. Locally, honor
  // GRAFFITICODE_CREDENTIALS (the graffiticode-project key, which owns the bucket) when
  // GOOGLE_APPLICATION_CREDENTIALS isn't already set, so dev works without extra setup.
  const keyPath = process.env.GRAFFITICODE_CREDENTIALS;
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && keyPath) {
    const { readFileSync } = await import("fs");
    const serviceAccount = JSON.parse(readFileSync(keyPath, "utf-8"));
    opts.credential = admin.credential.cert(serviceAccount);
  }
  let app: any;
  try {
    app = admin.app(APP_NAME); // reuse if already created in this process
  } catch {
    app = admin.initializeApp(opts, APP_NAME);
  }
  return admin.storage(app).bucket(STORAGE_BUCKET);
}

function getBucket() {
  if (!_bucketPromise) _bucketPromise = initBucket();
  return _bucketPromise;
}

async function upload(itemId: string, buffer: Buffer): Promise<string> {
  const bucket = await getBucket();
  const safe = String(itemId).replace(/[^A-Za-z0-9_-]/g, "_");
  const objectPath = `thumbnails/${safe}.png`;
  const file = bucket.file(objectPath);
  // Make the object public in the same write (predefinedAcl) rather than a separate
  // makePublic() call — the latter does its own read-modify-write of the ACL and races with the
  // save ("metadata ... was edited during the operation").
  await file.save(buffer, {
    resumable: false,
    contentType: "image/png",
    predefinedAcl: "publicRead",
    metadata: { cacheControl: "public, max-age=31536000" },
  });
  return `https://storage.googleapis.com/${STORAGE_BUCKET}/${objectPath}`;
}

export async function snap(args: SnapArgs): Promise<SnapResult> {
  const { item, task, lang, viewport, crop, width = DEFAULT_OUTPUT_W, token } = args;
  if (!item) throw new Error("snap: `item` is required");
  const itemId = item;
  // The owner's access token: from the compile request (config.authToken), or a local-dev
  // fallback env var so the language server can be exercised standalone.
  const tok = token || process.env.GC_SNAP_ACCESS_TOKEN || "";
  // Use an explicit task override if given; otherwise resolve the task id from the item id.
  const resolved = task ? { taskId: task, lang } : await resolveItem(item, tok);
  const url = buildFormUrl({ taskId: resolved.taskId, lang: resolved.lang, token: tok });

  const vpW = Math.max(1, Math.round(Number(viewport?.width) || VIEWPORT_W));
  const vpH = Math.max(1, Math.round(Number(viewport?.height) || VIEWPORT_H));

  const puppeteer: any = (await import("puppeteer")).default;
  const sharp: any = (await import("sharp")).default;

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
  try {
    const page = await browser.newPage();
    // Bound the layout: the form lays out into this window before we capture.
    await page.setViewport({ width: vpW, height: vpH, deviceScaleFactor: DEVICE_SCALE });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, SETTLE_MS));

    // Fixed-aspect top crop derived from the viewport. Default: full viewport width, height =
    // width / (4:3), anchored at the top. Clamped to the viewport so the clip stays on-page.
    const cropW = Math.min(crop?.width ?? vpW, vpW);
    const clip = {
      x: crop?.x ?? 0,
      y: crop?.y ?? 0,
      width: cropW,
      height: Math.min(crop?.height ?? Math.round(cropW / ASPECT), vpH),
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
