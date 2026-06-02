<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# L0013 Dialect Extensions

L0013 adds one side-effecting function, `snap`, to the base (L0000) dialect. It renders the
form view of an existing task to a PNG, uploads it to Firebase Storage at an item-derived path,
and returns the image URL. It is a utility dialect (used to generate thumbnails), not a
content-authoring target.

## L0013 Functions

| Function | Signature | Description |
| :------- | :-------- | :---------- |
| `snap` | `<record: record>` | Render `task`'s form view (in `lang`), crop, upload PNG, return `{ image, url, png, item }` |

## Record fields

- `task` (required) — task id to render.
- `lang` (required) — language id of `task`.
- `item` (optional) — upload path key (`thumbnails/{item}.png`); defaults to `task`.
- `crop` (optional) — `{ x, y, width, height }` clip in CSS pixels; defaults to a fixed top crop.
- `width` (optional) — output width in pixels.

## L0013 Example

```
snap {
  item: "demo1",
  task: "abc123",
  lang: "0166"
}..
```
