# Device matrix

| Test | Vega Virtual Device (SDK 0.24, Apple Silicon) | Fire TV Stick (Fire OS) | Fire TV Stick 4K Select (Vega) | Notes |
|---|---|---|---|---|
| Playback | ☐ | ☑ Angel One HLS plays at 1.0× (pos 9.11→31.59 over 27.5 s wall) | ☐ | Fire OS: needed `useExoplayerHls=true` + native rebuild (sample ships it off). Evidence `spike-evidence/fireos-sample-sanity-photo.jpg` |
| Audio switch | ☐ | ☑ **borderline** — en→de mid-playback, heard by tester, no rewind; stall 958 ms and 1.25 s (press→`playing`) on two runs vs the 1 s bar | ☐ | Fire OS: `getTracks()` still reports en active after the switch (KIT-029) |
| Cue events | ☐ | n/a (scheduler) | ☐ | |
| Two text tracks | ☐ | ☑ en + fr together in `CueOverlay`; toggling fr off/on works | ☐ | Fire OS: **every line rendered twice** in both tracks (KIT-026). Evidence `fireos-test4-two-tracks-duplicated.jpg` |
| Seek / rate | ☐ | ☑ seek to 3.837 → first cue in 10 ms; pause holds pos; 0.75× = 15.44 s media / 20.15 s wall | ☐ | Fire OS: player reports `ready` instead of `playing` during playback (KIT-028) |
| Own HLS via CloudFront | ☐ | ☑ Described `buildPackagerArgs` package (60 s synthetic, 2 audio incl. `describes-video` → role `description`, 3 WebVTT) from `described-media-dev` CloudFront: plays; switch to AD 0.59 s; 2nd text track on; seek to 1 s; pause holds; 0.75× = 15.43 s / 20.18 s | ☐ | Evidence: logcat run 2026-09-26 16:50. Boundary-spanning cues arrive twice in `onCue` on all tracks (KIT-026) |
| Source switch (KIT-023) | ☐ | ☑ 6 switches between own HLS (CloudFront) and Angel One: exactly one `tracks` per load, for the new host; one `ready` per load; `getTracks()` empty and position 0 right after each switch; 0 of 95 caption entries from the previous title; no `HLS_MASTER` error. A→B→A with B still buffering: B's load published nothing. After a switch the audio index resets (Original active); `selectAudio` marks the chosen track active. Switch → `ready` 1.7–3.3 s | ☐ | Evidence `spike-evidence/fireos-kit023-switch.log` (2026-09-27). Build of `95564b2` via Metro |
| Content Launcher intent | ☐ | n/a | ☐ | |

Fire OS column: Fire TV Stick `AFTSS`, Fire OS 7.7.1.6 (Android 9 / API 28), 2026-09-26, debug build of `react-native-multi-tv-app-sample@92c6f7c` + kit `ca269a8` via Yarn `portal:`. Stream: Shaka demo Angel One HLS. Evidence in `~/hackathon/spike-evidence/` (screencap is black on this stick; photos + logcat `KIT-SPIKE` lines). Own-HLS row: `https://dco7qa0c4m1pw.cloudfront.net/spike/hls/master.m3u8` (stack `described-media-dev`, eu-central-1).
