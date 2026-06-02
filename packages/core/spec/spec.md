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
| `snap` | `<record: record>` | Renders a task's form view, crops it, uploads a PNG, returns the image URL |

### snap

`snap` takes a record describing what to capture and returns a record
`{ image, url, png, item }`: a public CDN URL for the uploaded PNG (`url`/`image`),
the base64-encoded PNG (`png`), and the id the URL was derived from (`item`).

Record fields:

- `task` (required) — the task id whose form view is rendered.
- `lang` (required) — the language id of that task (e.g. `"0166"`).
- `item` (optional) — id used to derive the upload path `thumbnails/{item}.png`; defaults to `task`.
- `crop` (optional) — `{ x, y, width, height }` clip in CSS pixels; defaults to a fixed top crop.
- `width` (optional) — output width in pixels; height follows the crop aspect.

## Program Examples

Capture the form view of a spreadsheet task into a thumbnail:

```
snap {
  item: "demo1",
  task: "abc123",
  lang: "0166"
}..
```
