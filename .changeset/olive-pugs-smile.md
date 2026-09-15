---
'@moizp/vega-media-kit': patch
---

Fix `preferredText` auto-selection never delivering cues. The auto-selection path called the adapter directly and left the kit's selected-track set empty, so every WebVTT pushed through `onTextTrackData` was dropped and `onCue` never fired. Both the app-driven `selectText` and `preferredText` now go through one selection transition. Multi-track selection is unchanged.

Text-preference semantics are now explicit, which changes behaviour for `pickText` and for `KitPlayer`'s `preferredText`. An empty array is a choice, not an absence: `kinds: []` or `languages: []` now matches no track and selects nothing — that is how an app says "captions off" — where it previously fell through and returned every text track. An omitted key still means "any" (`{ languages: ['de'] }` matches any kind). Omitting `preferredText` on `KitPlayer` no longer auto-selects anything at all: text stays off until the app asks for it, instead of turning on every caption and description track at once. `pickText` called with no preference argument still returns every track unfiltered.

Deselecting a text track now clears the overlay immediately. Pruning a track from the cue scheduler did not re-evaluate the active cues, so turning captions off while paused left the last cue on screen until the next position update.
