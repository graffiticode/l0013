<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# L0013 Usage Guide

Agent-facing guide for authoring L0013 programs. Read this before composing a `create_item` prompt or an `update_item` modification.

## Overview

L0013 is a utility dialect that photographs another task. Given a `task` id and its `lang`, `snap` renders that task's form view in a headless browser, crops the capture to a fixed aspect (a top crop by default), uploads the resulting PNG to Firebase Storage at an item-derived path (`thumbnails/{item}.png`), and returns a record `{ image, url, png, item }` — a public CDN URL for the image (`url`/`image`), the base64-encoded PNG (`png`), and the id the path was derived from (`item`). L0013 does not author any content of its own; it only captures the rendered output of an existing task, so it is the right tool when the job is "make a thumbnail / screenshot of this task" and never when the job is to create assessments, spreadsheets, charts, diagrams, boards, or data — those belong in the domain-specific dialects. Every L0013 program is a single `snap { ... }..` expression whose evaluation performs the capture and upload as a side effect.

The one keyword is `snap`, applied to a record. Required fields: `task` (the task id to render) and `lang` (that task's language id, e.g. `"0166"`). Optional fields: `item` (the key for the upload path; defaults to `task`), `crop` (`{ x, y, width, height }` clip in CSS pixels; defaults to a fixed top crop), and `width` (output width in pixels; the height follows the crop aspect). Record fields use `key: value` pairs; every program ends with `..`.

In scope: rendering a given task's form view to an image, cropping it, uploading the PNG, and returning its URL + base64. Out of scope: authoring domain content, editing or recompiling the target task (it is rendered read-only), interactive UI, and cross-language composition (L0013 takes a task reference; it does not import another dialect's functions).

## Vocabulary Cues

Say this to get that:

- **snap** — "thumbnail / screenshot task X in lang Y" → `snap { task: "X", lang: "Y" }..`.
- **item** — "store it under id Z" → adds `item: "Z"` so the path is `thumbnails/Z.png`.
- **crop** — "just the top 800×600" → adds `crop: { x: 0, y: 0, width: 800, height: 600 }`.
- **width** — "at 240px wide" → adds `width: 240`.
- **Program terminator** — every L0013 program ends with `..`. Don't omit it.

## Example Prompts

- *"Capture a thumbnail of task abc123 in language 0166."* → `thumbnail`
- *"Snapshot task abc123 (lang 0173) and store it under item demo1."* → `thumbnail`
- *"Thumbnail task abc123 (lang 0166) at 240px wide."* → `thumbnail`

## Out of Scope

- **Authoring content** — assessments, spreadsheets, charts, diagrams, boards, data pipelines. L0013 only photographs another task's output; author with the domain-specific dialects.
- **Editing the target** — the task is rendered read-only; `snap` never recompiles or mutates it.
- **Interactive UI** — the output is a static image.
- **Cross-language composition** — L0013 takes a task reference; it does not `import` another dialect's functions.
