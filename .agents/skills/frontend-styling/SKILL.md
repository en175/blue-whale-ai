---
name: frontend-styling
description: Use when styling glass/translucent surfaces, scrollable/virtualized/masonry lists, cards, skeletons, or scroll-time compositing artifacts under web/. Do not use for ordinary static layout styling.
---

# Frontend styling

This skill supplements `frontend-delivery`; it does not replace that skill's delivery, request, or verification workflow. Preserve visual hierarchy without creating unstable browser compositing layers.

## Glass boundary

Glass is a treatment for a bounded, stationary surface, not a default for card grids or scrollable content.

- A fixed/sticky header, modal shell, or modal overlay may use `backdrop-filter` only when it does not move with repeated list items. Add a short code comment at that declaration explaining the boundary.
- When a page has a scrolling collection, place any allowed glass effect on its stationary header or overlay—not on the page scroll container or collection itself.
- Reuse semantic surface tokens and retain a readable static background fallback; translucency must not be the only source of contrast.

## Scroll and repeated content

For a scrollable, paginated, virtualized, or masonry collection—or a visual defect visible while scrolling—read [references/scroll-compositing.md](references/scroll-compositing.md). That reference owns the list-level rendering rule and regression guidance.

If a stationary glass shell contains a scrolling region, treat them as separate rendering boundaries: the shell may be glass while the list stays static. Do not use this skill for ordinary spacing, color, typography, or static-page layout changes.
