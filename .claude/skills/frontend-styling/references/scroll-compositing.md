# Scroll compositing safety

Treat a surface as a list boundary when it scrolls, repeats cards/items, virtualizes or masonry-positions content, or contains a loading skeleton for such content. Black rectangles, double images, lost text, and ghosting during scroll are compositor symptoms first—not a reason to add more stacking contexts or transforms.

## Required rendering rule

The following must not declare `backdrop-filter` or `-webkit-backdrop-filter`, including a `none` value or a custom-property value:

- the scrolling container;
- repeated items and their hover, selected, and focused states;
- list skeletons and their wrappers;
- thumbnail/media overlays; and
- persistent controls inside an item, such as selection toggles and overflow menus.

Use static `background`, `border`, and `box-shadow` instead. Reuse the closest semantic static item-surface token rather than creating a new translucent card surface. State selectors must keep the same no-filter rule.

The only exception is a fixed/sticky header or modal overlay that does not scroll with the list items. Keep a short code comment at that declaration documenting the boundary.

## Debug and verify

1. Inspect the affected stylesheet for both filter property names across the list boundary, including pseudo-state selectors and nested controls.
2. Remove the list-level filter before trying z-index, `transform`, or opacity workarounds.
3. Exercise a realistic scroll with the actual animated/video background when one exists; confirm no dark blocks, ghosting, duplicated layers, or missing content appear.
4. Preserve targeted behavioral tests and add a focused regression test when the rendering structure itself is observable.

This rule is about `backdrop-filter`; do not blanket-ban ordinary `filter` effects on image content unless that effect is independently implicated.
