// SPDX-License-Identifier: MIT
// L0013's Form: renders the image produced by a `snap` program (the uploaded thumbnail), or
// compile errors. Modeled on L0003's IMAGE rendering. Injected into the shared View (from
// @graffiticode/l0000-view), which supplies `state.data` and `state.errors`.
import "../../index.css";
import type { FormProps, CompileError } from "@graffiticode/l0000-view";

function classNames(...classes: any[]) {
  return classes.filter(Boolean).join(" ");
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

function renderData(data: any) {
  // `snap` output is { image, url, png, item }. `image` (alias of `url`) is the uploaded PNG.
  const src = typeof data?.image === "string" ? data.image : data?.url;
  if (typeof src === "string") {
    return <img src={src} alt={data?.item ? `thumbnail ${data.item}` : "thumbnail"} />;
  }
  const { png, ...rest } = data && typeof data === "object" ? data : { png: undefined };
  return <pre className="text-xs">{JSON.stringify(rest ?? data, null, 2)}</pre>;
}

export const Form = ({ state }: FormProps) => {
  const errors: CompileError[] = state.errors ?? [];
  return (
    <div className="rounded-md font-mono flex flex-col gap-4 p-4 bg-white text-zinc-900">
      {errors.length > 0 ? renderErrors(errors) : renderData(state.data)}
    </div>
  );
};
