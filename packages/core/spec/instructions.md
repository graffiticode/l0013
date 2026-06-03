<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# L0013 Dialect Extensions

L0013 adds one side-effecting function, `snap`, to the base (L0000) dialect. It renders the
form view of an existing task to a PNG, uploads it to Firebase Storage at an item-derived path,
and returns the image URL. It is a utility dialect (used to generate thumbnails), not a
content-authoring target.

## L0013 Functions

| Function | Signature | Description |
| :------- | :-------- | :---------- |
| `snap` | `<opts: record>` | Render the item's form view, crop, upload PNG, return `{ image, url, png, item }` |
| `item` | `<string opts: opts>` | Set the item id to capture (task + language resolved from it) |
| `viewport` | `<record opts: opts>` | Set the browser window `{ width, height }` the form lays out into |
| `crop` | `<record opts: opts>` | Set the crop `{ x, y, width, height }` (CSS pixels) |
| `width` | `<number opts: opts>` | Set the output width in pixels |

Options are assembled by chaining the arity-2 modifiers onto a base record `{}`. `item` is
required; `viewport`, `crop`, and `width` are optional.

## L0013 Example

```
snap item "item123" {}..
```
