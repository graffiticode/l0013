// SPDX-License-Identifier: MIT
// The side-effecting core of L0013: render a task's form view in headless Chrome, crop it
// (content-aware — trim to the inked content by default, or take the densest fixed-aspect band
// with `slice "W:H"`), upload the PNG to an item-derived Firebase Storage path, and return the
// public URL + base64. Heavy, node-only deps (puppeteer / sharp / firebase-admin) are imported
// lazily here so that merely importing the compiler (e.g. build-static) does not pull them in.

const API_URL = process.env.GRAFFITICODE_API_URL || "https://api.graffiticode.org";
// The app's item form route (`/form/{itemId}`) resolves an item id to its task + language and
// renders it — that's how `snap` gets the lang/task "from the item id" without a separate lookup.
const APP_URL = process.env.GRAFFITICODE_APP_URL || "https://app.graffiticode.org";
const STORAGE_BUCKET = process.env.THUMBNAIL_BUCKET || "graffiticode.appspot.com";

// Default viewport — the window the form lays out into (most form views fill the window). The
// crop is content-aware (see contentRect); only the explicit `crop` modifier uses a fixed clip.
const VIEWPORT_W = 1024;
const VIEWPORT_H = 768;
const DEVICE_SCALE = 2;
const ASPECT = 4 / 3; // width : height — used only for the blank-page fallback
const DEFAULT_OUTPUT_W = 1024; // crisp on retina; caller can override via `width`
const SETTLE_MS = 1500; // let the form paint / post its first data-updated
const INK_THRESHOLD = 12; // greyscale distance from the background to count a pixel as "ink"
const INK_MARGIN = 8 * DEVICE_SCALE; // padding (capture px) around the trimmed content box
// Lower bound on the zoom-1 size search, as a fraction of the zoom-0 frame's linear size — purely
// to bound the search loop and avoid degenerate sub-pixel windows. It does NOT set the zoom-1
// size: that's chosen by the density score (ink²/area), which disfavors tiny windows on its own.
const ZOOM_SEARCH_MIN = 0.05;
const ZOOM_SEARCH_STEP = 0.9; // geometric shrink between candidate sizes in the zoom-1 size search

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
  slice?: string; // "W:H" → crop the densest band at that aspect (e.g. "4:1" wide, "1:4" tall)
  zoom?: number; // 0..1 zoom within a `slice`: 0 = frame all ink, 1 = densest region (max ink²/area)
  crop?: SnapCrop; // explicit clip rectangle (manual override of the content-aware crop)
  width?: number; // max output width (px); with `height`, defines a bounding box (fit inside)
  height?: number; // max output height (px)
  token?: string;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Parse a "W:H" ratio string → aspect (width / height), or null if malformed.
function parseAspect(slice?: string): number | null {
  if (typeof slice !== "string") return null;
  const parts = slice.split(":");
  if (parts.length !== 2) return null;
  const w = parseFloat(parts[0]);
  const h = parseFloat(parts[1]);
  if (!(w > 0) || !(h > 0)) return null;
  return w / h;
}

const SCAN_W = 512; // analyze a downscaled copy; positioning doesn't need full resolution

// Decide the crop rectangle (in captured-pixel space) from a full-page screenshot. Analysis runs
// on a downscaled greyscale copy with an integral image (O(1) per window):
//   - `slice` aspect + `zoom` → the zoom-0 frame is the smallest box at that aspect *containing*
//     all the ink (e.g. `slice "1:1"` → a square enclosing every inked pixel); zoom 1 is the
//     densest *natural* region — the target-aspect window inside the frame that maximizes ink²/area
//     (= ink × density), i.e. the tightest window still capturing a dense cluster (e.g. the square
//     bounding a pie chart); `zoom` interpolates the window size between the two and re-finds the
//     densest position *inside* the frame, so zooming stays on-content (a bare `slice` = zoom 0);
//   - `slice` aspect alone → the densest target-aspect rectangle, sized to fit the content and
//     positioned by a 2-D search over both axes (works for wide "4:1" and tall "1:4" alike);
//   - otherwise → the bounding box of inked content (trim whitespace), plus a small margin.
// Falls back to the top region for an essentially blank page.
async function contentRect(
  sharp: any,
  shot: Buffer,
  slice?: string,
  zoom?: number,
): Promise<Rect> {
  const meta = await sharp(shot).metadata();
  const fullW: number = meta.width || SCAN_W;
  const fullH: number = meta.height || SCAN_W;
  const scanW = Math.min(fullW, SCAN_W);
  const scale = fullW / scanW;

  const { data, info } = await sharp(shot)
    .resize({ width: scanW })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W: number = info.width;
  const H: number = info.height;
  const ch: number = info.channels || 1;
  const bg = data[0]; // background = top-left pixel

  // Integral image of the ink mask (size (W+1)×(H+1)) + content bounding box.
  const integral = new Int32Array((W + 1) * (H + 1));
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    const rowOff = (y + 1) * (W + 1);
    const prevOff = y * (W + 1);
    const base = y * W * ch;
    let rowAcc = 0;
    for (let x = 0; x < W; x++) {
      if (Math.abs(data[base + x * ch] - bg) > INK_THRESHOLD) {
        rowAcc++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      integral[rowOff + x + 1] = integral[prevOff + x + 1] + rowAcc;
    }
  }
  // Sum of ink over [x0, x1) × [y0, y1) in scan space.
  const sumRect = (x0: number, y0: number, x1: number, y1: number) =>
    integral[y1 * (W + 1) + x1] - integral[y0 * (W + 1) + x1] -
    integral[y1 * (W + 1) + x0] + integral[y0 * (W + 1) + x0];

  // Map a scan-space rect → full-resolution Rect (clamped to the image).
  const mapRect = (x0: number, y0: number, x1: number, y1: number): Rect => {
    const left = Math.max(0, Math.min(fullW - 1, Math.round(x0 * scale)));
    const top = Math.max(0, Math.min(fullH - 1, Math.round(y0 * scale)));
    const width = Math.max(1, Math.min(fullW - left, Math.round((x1 - x0) * scale)));
    const height = Math.max(1, Math.min(fullH - top, Math.round((y1 - y0) * scale)));
    return { left, top, width, height };
  };

  if (maxX < 0) {
    // Blank page → top region so we never produce an empty crop.
    return { left: 0, top: 0, width: fullW, height: Math.min(fullH, Math.round(fullW / ASPECT)) };
  }

  const aspect = parseAspect(slice);
  if (!aspect) {
    // Default: trim to the inked bounding box (+ small margin in scan space).
    const m = Math.max(1, Math.round(INK_MARGIN / scale));
    return mapRect(
      Math.max(0, minX - m), Math.max(0, minY - m),
      Math.min(W, maxX + 1 + m), Math.min(H, maxY + 1 + m),
    );
  }

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;

  // A 2-D sliding-window max-ink search at a fixed window size, with the window constrained to lie
  // within the region [rx0, ry0, rx1, ry1) (defaults to the whole image). Integral image →
  // O(1)/position. Used both to place the full frame and to find the densest sub-window inside it.
  const maxInkWindow = (
    wwIn: number, whIn: number,
    rx0 = 0, ry0 = 0, rx1 = W, ry1 = H,
  ) => {
    const ww = Math.max(1, Math.min(rx1 - rx0, wwIn));
    const wh = Math.max(1, Math.min(ry1 - ry0, whIn));
    let best = -1, bx = rx0, by = ry0;
    for (let y = ry0; y <= ry1 - wh; y++) {
      for (let x = rx0; x <= rx1 - ww; x++) {
        const s = sumRect(x, y, x + ww, y + wh);
        if (s > best) { best = s; bx = x; by = y; }
      }
    }
    return { ink: best, x: bx, y: by, ww, wh };
  };

  // The zoom-0 frame = "all the ink": the smallest target-aspect rectangle that *contains* the
  // whole content bounding box (so `slice "1:1"` is a square enclosing every inked pixel, not a
  // square that fits inside it), centered on the content and clamped to the image. Every zoomed
  // crop is a sub-window *inside* this frame, so zooming always stays on the same content.
  let fw = bw, fh = bh;
  if (fw < fh * aspect) fw = Math.round(fh * aspect); // content narrower than aspect → widen
  else fh = Math.round(fw / aspect); //                  content wider/shorter → heighten
  fw = Math.min(fw, W);
  fh = Math.min(fh, H);
  const cx = (minX + maxX + 1) / 2;
  const cy = (minY + maxY + 1) / 2;
  const fx = Math.max(0, Math.min(W - fw, Math.round(cx - fw / 2)));
  const fy = Math.max(0, Math.min(H - fh, Math.round(cy - fh / 2)));
  const base = { x: fx, y: fy, ww: fw, wh: fh };

  // zoom 0 = the full frame (all ink); zoom 1 = the densest *natural* region: the target-aspect
  // window inside the frame that maximizes ink²/area (= ink × density) — the tightest window still
  // capturing a dense cluster (e.g. the square bounding a pie chart). zoom interpolates the window
  // *size* between the two, then re-finds the densest position at that size. With no zoom, a
  // `slice` defaults to framing all the ink (zoom 0) — the least surprising default.
  const z = zoom == null ? 0 : Math.max(0, Math.min(1, Number(zoom)));
  if (z <= 0) return mapRect(base.x, base.y, base.x + base.ww, base.y + base.wh);

  // Find the zoom-1 size: scan candidate window sizes (geometric steps) inside the frame and keep
  // the best density score. Size — not position — is what zoom interpolates.
  let bestScore = -1, denseWh = base.wh;
  const minWh = Math.max(2, Math.round(base.wh * ZOOM_SEARCH_MIN));
  for (let wh = base.wh; wh >= minWh; wh = Math.round(wh * ZOOM_SEARCH_STEP)) {
    const r = maxInkWindow(
      Math.round(wh * aspect), wh,
      base.x, base.y, base.x + base.ww, base.y + base.wh,
    );
    const score = (r.ink * r.ink) / (r.ww * r.wh);
    if (score > bestScore) { bestScore = score; denseWh = r.wh; }
  }

  const wh = Math.max(1, Math.round(base.wh - z * (base.wh - denseWh)));
  const r = maxInkWindow(
    Math.round(wh * aspect), wh,
    base.x, base.y, base.x + base.ww, base.y + base.wh,
  );
  return mapRect(r.x, r.y, r.x + r.ww, r.y + r.wh);
}

export interface SnapResult {
  image: string; // alias of `url` — the key the L0013 form view renders
  url: string; // public CDN URL of the uploaded PNG
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
    metadata: { cacheControl: "no-cache" },
  });
  return `https://storage.googleapis.com/${STORAGE_BUCKET}/${objectPath}`;
}

export async function snap(args: SnapArgs): Promise<SnapResult> {
  const { item, task, lang, viewport, slice, zoom, crop, width, height, token } = args;
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

    // Output sizing: fit the crop within a (maxW × maxH) box, preserving its aspect. With only
    // `width` the height is derived from the aspect (and vice-versa); with neither, default width.
    const reqW = width != null ? Math.max(1, Math.round(Number(width))) : undefined;
    const reqH = height != null ? Math.max(1, Math.round(Number(height))) : undefined;
    const resizeOpts =
      reqW == null && reqH == null
        ? { width: DEFAULT_OUTPUT_W }
        : { width: reqW, height: reqH, fit: "inside" as const };

    const hasExplicitCrop =
      crop && (crop.x != null || crop.y != null || crop.width != null || crop.height != null);

    let png: Buffer;
    if (hasExplicitCrop) {
      // Manual override: a fixed clip in viewport (CSS-pixel) space, anchored at the top.
      const cropW = Math.min(crop!.width ?? vpW, vpW);
      const clip = {
        x: crop!.x ?? 0,
        y: crop!.y ?? 0,
        width: cropW,
        height: Math.min(crop!.height ?? Math.round(cropW / ASPECT), vpH),
      };
      const shot = (await page.screenshot({ type: "png", clip })) as Buffer;
      png = await sharp(shot).resize(resizeOpts).png().toBuffer();
    } else {
      // Content-aware: capture the whole form, then trim to the inked content (default) or take
      // the densest fixed-aspect region (`slice`). The resize fits the crop into the output box.
      const shot = (await page.screenshot({ type: "png", fullPage: true })) as Buffer;
      const rect = await contentRect(sharp, shot, slice, zoom);
      png = await sharp(shot).extract(rect).resize(resizeOpts).png().toBuffer();
    }

    const publicUrl = await upload(itemId, png);
    return { image: publicUrl, url: publicUrl, item: itemId };
  } finally {
    await browser.close();
  }
}
