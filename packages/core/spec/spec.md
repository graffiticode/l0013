<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# L0013 Vocabulary

This specification documents the dialect-specific function added by the **L0013**
language of Graffiticode. L0013 extends the core (L0000) language with a single
side-effecting function, `snap`, that renders a task's form view to an image.

The core language specification — syntax, semantics, and base library — can be found here:
[Graffiticode Language Specification](./graffiticode-language-spec.html)

## Functions

| Function | Signature | Description |
| :------- | :-------- | :---------- |
| `snap` | `<opts: record>` | Renders an item's form view, crops it, uploads a PNG, returns the image URL |
| `item` | `<string opts: opts>` | Sets the item id to capture (task + language are resolved from it) |
| `viewport` | `<record opts: opts>` | Sets the browser window `{ width, height }` the form lays out into |
| `crop` | `<record opts: opts>` | Sets the crop `{ x, y, width, height }` (CSS pixels) |
| `width` | `<number opts: opts>` | Sets the output width in pixels |

### snap

`snap` takes an options record — assembled by chaining the modifier functions onto a base
record `{}` — and returns `{ image, url, png, item }`: a public CDN URL for the uploaded PNG
(`url`/`image`), the base64-encoded PNG (`png`), and the item id the upload path was derived
from (`item`). The task id and language are resolved from the item id.

Modifiers (each arity 2 — a value plus the rest of the options):

- `item "<id>"` (required) — the item to capture; its form view is rendered.
- `viewport { width: height: }` (optional) — the browser window the form lays out into; defaults to 1024×768. Most form views fill the window, so this bounds the layout before capture.
- `crop { x: y: width: height: }` (optional) — clip in CSS pixels; defaults to the top 4:3 of the viewport.
- `width <n>` (optional) — output width in pixels; height follows the crop aspect.

## Program Examples

Capture an item's form view into a thumbnail (simplest form):

```
snap item "item123" {}..
```

With a crop and output width:

```
snap width 240 crop { x: 0 y: 0 width: 800 height: 600 } item "item123" {}..
```
