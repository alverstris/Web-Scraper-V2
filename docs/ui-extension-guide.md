# Adding styling and animation

The current interface deliberately uses plain static controls. Domain behaviour does not depend on CSS, an animation library, a map SDK or a transition callback. No final brand or motion direction has been selected.

## Where changes belong

| Concern | Extension point |
| --- | --- |
| Colour, spacing, typography, surfaces and duration | `src/styles.css` custom properties |
| Shared controls and semantic sections | `src/ui.tsx`, particularly `Panel` and `Field` |
| Configuration and confirmation flow | `src/App.tsx` draft and submitted run state |
| Result cards, details, list/map presentation | `src/results.tsx` |
| Live map SDK | Lazy `src/google-map.tsx` adapter; domain data contains no SDK objects |
| Progress, selected property and filter transitions | Stable listing IDs, `data-motion-key` and `data-motion-region` attributes |
| Reduced motion | `useReducedMotion` and CSS media query |
| Filtering and import work | `src/dataset.worker.ts`, `src/worker-client.ts` |
| Ad placement lifecycle | `src/ads.tsx`; never mount an ad from a result-filter effect |

Keep `shared/contracts.ts`, filtering, portable validation and backend services independent of visual libraries. A single primary motion library can be added later at the presentation layer. Specialist 3D or illustration dependencies are optional and should solve a specific interaction.

## Invariants to preserve

Draft commute settings and the definition attached to a dataset are separate. An animation may reveal a newly accepted run, but it must never start one or change the label of old results. Property filters and geographic area selection only invoke the local worker. Preserve the selected listing ID even when it is outside the current filter.

Keep buttons operable during transitions. Do not wait for an animation completion callback to reserve allowance, poll progress or enable cancellation. Use real manifest counters for progress, including partial and failed states. Keep keyboard focus on stable semantic controls; animate wrappers rather than replacing focused buttons.

Apply enter/exit effects to a bounded set of changed cards. Do not replay the whole list after each filter update. Avoid moving a button under the pointer as new results arrive. The current implementation caps rendered cards in pages while filtering the entire loaded universe; a later virtualiser can replace rendering without changing the filter contract.

Map markers represent origins and their precision. Do not turn straight connectors into apparent route geometry or generate commute contours from these rows. The live map, dense-marker clustering and provider attribution need their own configured staging review. The list remains a complete alternative to map interaction.

## Recheck after visual changes

Run the existing browser journey and mobile/reduced-motion checks. Then inspect keyboard focus, zoom, touch targets, overlap, layout movement and actual motion on representative devices. Final motion and performance evidence is deliberately not claimed by the static implementation.
