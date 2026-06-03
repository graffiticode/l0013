// SPDX-License-Identifier: MIT
// L0013's Form: renders the image produced by a `snap` program (the uploaded thumbnail), showing
// a "Working…" animation until the image is ready (compile in flight + image loading), or compile
// errors. Injected into the shared View (from @graffiticode/l0000-view), which supplies
// `state.data` and `state.errors`.
import "../../index.css";
import { useState, useEffect } from "react";
import type { FormProps, CompileError } from "@graffiticode/l0000-view";

function Working() {
  return (
    <div className="flex items-center gap-3 p-4 text-sm text-zinc-500">
      <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
      Working…
    </div>
  );
}

// Shown while the `snap` compile is in flight — i.e. while the server is rendering the target form
// in headless Chrome and capturing it. The scrape can take a while (and we don't time it out), so
// we show an elapsed-seconds counter to make clear it's still working rather than hung.
function Scraping() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-3 p-4 text-sm text-zinc-500">
      <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
      Scraping… {secs}s
    </div>
  );
}

function renderErrors(errors: CompileError[]) {
  return (
    <div className="flex flex-col gap-2">
      {errors.map((error, i) => (
        <div
          key={i}
          className="rounded-md p-3 border text-sm bg-red-50 border-red-200 text-red-800"
        >
          {error.message}
        </div>
      ))}
    </div>
  );
}

// Renders the thumbnail, showing the "Working…" animation until the image has loaded. `src` is
// keyed so swapping to a new image resets the loading state.
function ThumbnailImage({ src, alt }: { src: string; alt: string }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  return (
    <div className="relative">
      {status === "loading" && <Working />}
      {status === "error" && (
        <div className="p-4 text-sm text-zinc-500">Couldn’t load image.</div>
      )}
      <img
        key={src}
        src={src}
        alt={alt}
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("error")}
        style={{ display: status === "loaded" ? "block" : "none" }}
      />
    </div>
  );
}

export const Form = ({ state }: FormProps) => {
  const errors: CompileError[] = state.errors ?? [];
  const data: any = state.data;
  const src = typeof data?.url === "string" ? data.url : undefined;

  return (
    <div className="rounded-md font-mono flex flex-col gap-4 p-4 bg-white text-zinc-900">
      {errors.length > 0 ? (
        renderErrors(errors)
      ) : typeof src === "string" ? (
        <ThumbnailImage src={src} alt={data?.item ? `thumbnail ${data.item}` : "thumbnail"} />
      ) : (
        // No image yet (compile still in flight = the server is scraping) → show the counter.
        <Scraping />
      )}
    </div>
  );
};
