// SPDX-License-Identifier: MIT
// L0013's View: a minimal, read-only harness that fetches the snap task's compiled data and
// renders the Form. Unlike the shared @graffiticode/l0000-view View — which renders blank until
// data is renderable — this keeps the Form mounted throughout, so the Form's "Working…" animation
// is visible during the data fetch / render. L0013 output is a static image (non-interactive), so
// there's no recompile-on-edit path. We only post `data-updated` to the host once real data is
// ready, leaving the console's iframe spinner up during the wait.
import { useEffect, useState } from "react";
import type { FormComponent, CompileError } from "@graffiticode/l0000-view";

function apiUrl(): string {
  const host = window.document.location.host;
  return host.indexOf("localhost") === 0 ? "http://localhost:3100" : "https://api.graffiticode.org";
}

export const View = ({ Form }: { Form: FormComponent }) => {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id") ?? undefined;
  const accessToken = params.get("access_token") ?? undefined;
  const origin = params.get("origin") ?? undefined;

  const [data, setData] = useState<any>(undefined);
  const [errors, setErrors] = useState<CompileError[]>([]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`${apiUrl()}/data?id=${encodeURIComponent(id)}`, {
          headers: { Authorization: accessToken || "" },
        });
        const env = await resp.json();
        if (cancelled) return;
        if (env.status !== "success") {
          setErrors([{ message: env.error?.message || `Failed to load ${id}.` } as CompileError]);
          return;
        }
        // env.data is the compiled snap output { image, url, item } (or a nested { data, errors }).
        const out =
          env.data && typeof env.data === "object" && Array.isArray(env.data.errors)
            ? { data: env.data.data, errors: env.data.errors as CompileError[] }
            : { data: env.data, errors: [] as CompileError[] };
        setData(out.data);
        setErrors(out.errors);
        if (origin) window.parent.postMessage({ type: "data-updated", data: out.data }, origin);
      } catch (e: any) {
        if (!cancelled) setErrors([{ message: String(e?.message || e) } as CompileError]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, accessToken, origin]);

  // `data` is undefined while loading → the Form renders its "Working…" animation.
  return <Form state={{ data, errors, apply: () => {} }} />;
};
