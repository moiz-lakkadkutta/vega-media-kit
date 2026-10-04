---
'@moizp/vega-media-kit': patch
---

**Cue times are millisecond-exact.** `parseVtt` and `parseTimestamp` now sum hours, minutes, seconds and milliseconds in whole milliseconds and divide once, so `00:00:03.837` is exactly `3.837` (previously `3.8369999999999997`) and every cue `start`/`end` reaching `onCue` compares with `===`. Ends extended to `minDuration` and the one-frame gap merge are also computed in whole milliseconds (a gap of exactly `mergeGap` is never merged; `minDuration`/`mergeGap` are rounded to ms). `formatTimestamp` rounds to the millisecond before splitting, so it no longer prints `.1000` for a value just below a whole second.
