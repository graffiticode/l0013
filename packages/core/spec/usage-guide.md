<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# L0013 Usage Guide

Agent-facing guide for authoring L0013 programs. Read this before composing a `create_item` prompt or an `update_item` modification.

## Overview

L0013 is a utility dialect that photographs an item. Given an item id, `snap` renders that item's form view in a headless browser (the task id and language are resolved from the item id), crops the capture to a fixed aspect (a top crop by default), uploads the resulting PNG to Firebase Storage at an item-derived path (`thumbnails/{item}.png`), and returns a record `{ image, url, png, item }` — a public CDN URL for the image (`url`/`image`), the base64-encoded PNG (`png`), and the item id the path was derived from (`item`). L0013 does not author any content of its own; it only captures the rendered output of an existing item, so it is the right tool when the job is "make a thumbnail / screenshot of this item" and never when the job is to create assessments, spreadsheets, charts, diagrams, boards, or data — those belong in the domain-specific dialects. Every L0013 program is a single `snap <opts>..` expression whose evaluation performs the capture and upload as a side effect.

A program is `snap` applied to an options record that is assembled by chaining arity-2 modifier functions onto a base record `{}`. The required modifier is `item "<id>"` (the item to capture). Optional modifiers: `crop { x: y: width: height: }` (a clip in CSS pixels; defaults to a fixed top crop) and `width <n>` (output width in pixels; the height follows the crop aspect). The simplest program is `snap item "item123" {}..`; every program ends with `..`.

In scope: rendering a given item's form view to an image, cropping it, uploading the PNG, and returning its URL + base64. Out of scope: authoring domain content, editing or recompiling the target item (it is rendered read-only), interactive UI, and cross-language composition (L0013 takes an item reference; it does not import another dialect's functions).

## Vocabulary Cues

Say this to get that:

- **snap** — "thumbnail / screenshot item X" → `snap item "X" {}..`.
- **item** — the required modifier naming the item to capture: `item "item123" {}`.
- **viewport** — "render in a 1280×800 window" → `viewport { width: 1280 height: 800 }`. Bounds the form's layout before capture (most form views fill the window).
- **crop** — "just the top 800×600" → `crop { x: 0 y: 0 width: 800 height: 600 }`.
- **width** — "at 240px wide" → `width 240`.
- **Program terminator** — every L0013 program ends with `..`. Don't omit it.

## Example Prompts

- *"Capture a thumbnail of item item123."* → `thumbnail`
- *"Thumbnail item item123 at 240px wide."* → `thumbnail`
- *"Snapshot item item123, just the top 800×600."* → `thumbnail`

## Out of Scope

- **Authoring content** — assessments, spreadsheets, charts, diagrams, boards, data pipelines. L0013 only photographs an existing item's output; author with the domain-specific dialects.
- **Editing the target** — the item is rendered read-only; `snap` never recompiles or mutates it.
- **Interactive UI** — the output is a static image.
- **Cross-language composition** — L0013 takes an item reference; it does not `import` another dialect's functions.
