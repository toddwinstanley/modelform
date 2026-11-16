---
'@modelform/react-native': minor
---

Input groups: collapse items and drag them to reorder.

- Tapping an item's title collapses it to one line with a summary of its values ("100 kg · 5"). Adding or duplicating an item collapses the other filled ones; an item with a problem stays open; a save or discard opens them all again.
- The handle (≡) drags an item past the others. The list keeps its order until the item is dropped, so the gesture isn't interrupted on the web. The ↑/↓ buttons stay for accessibility.
- `FormGroup` gains an optional `edited` flag.
- Fix: a group's field problems showed as soon as any field in it was edited. Like plain inputs, they now show for edited fields, and for all fields once a Save is refused.
