// SPDX-License-Identifier: MIT
/* Copyright (c) 2023, ARTCOMPILER INC */
//
// L0013 inherits L0000: its Checker/Transformer extend L0000's, adding a single handler for
// the `snap` keyword. `snap { task, lang, item?, crop?, width? }` renders the form view of a
// task, crops it to a fixed aspect, uploads the PNG to an item-derived Storage URL, and
// returns `{ image, url, png, item }`. Unhandled tags fall through to L0000's base handlers.
import {
  Checker as BaseChecker,
  Transformer as BaseTransformer,
  Compiler,
} from "@graffiticode/l0000";
import { snap } from "./snap.js";

export class Checker extends BaseChecker {
  [key: string]: any;

  SNAP(node, options, resume) {
    // Validate the record argument: require `task` and `lang`; item/crop/width optional.
    this.visit(node.elts[0], options, (e0, v0) => {
      const err = Array.isArray(e0) ? [...e0] : e0 ? [e0] : [];
      const coord = this.nodePool[node.elts[0]]?.coord ?? node.coord ?? {};
      if (!v0 || typeof v0 !== "object" || Array.isArray(v0)) {
        err.push({
          message: "snap expects a record argument, e.g. snap { task: <id>, lang: <id> }..",
          ...coord,
        });
      } else {
        if (!v0.task) err.push({ message: "snap: missing required `task`.", ...coord });
        if (!v0.lang) err.push({ message: "snap: missing required `lang`.", ...coord });
      }
      resume(err, node);
    });
  }
}

export class Transformer extends BaseTransformer {
  [key: string]: any;

  SNAP(node, options, resume) {
    this.visit(node.elts[0], options, async (e0, v0) => {
      const err = Array.isArray(e0) ? [...e0] : e0 ? [e0] : [];
      const coord = node.coord ?? {};
      try {
        const args = v0 && typeof v0 === "object" ? v0 : {};
        // The api server forwards the request's access token via config (see api/compile.ts).
        const token = options?.config?.authToken || options?.config?.auth || "";
        const out = await snap({
          task: args.task,
          lang: args.lang,
          item: args.item,
          crop: args.crop,
          width: args.width,
          token,
        });
        resume(err, out);
      } catch (x: any) {
        err.push({ message: `snap failed: ${x?.message || String(x)}`, ...coord });
        resume(err, null);
      }
    });
  }
}

export const compiler = new Compiler({
  langID: "0013",
  version: "v0.0.1",
  Checker,
  Transformer,
});
