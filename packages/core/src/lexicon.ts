// SPDX-License-Identifier: MIT
// L0013's lexicon = L0000's base vocabulary + L0013's single addition: `snap`.
// `snap { task, lang, item?, crop?, width? }` renders a task's form view, crops it to a
// fixed aspect, uploads the PNG, and returns the image URL (child keys win on merge).
import { lexicon as base } from "@graffiticode/l0000";

const additions = {
  snap: { tk: 1, name: "SNAP", cls: "function", length: 1, arity: 1 },
};

export const lexicon = { ...base, ...additions };
