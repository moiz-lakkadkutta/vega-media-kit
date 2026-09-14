# Week-0 spike (KIT-001) — acceptance tests

Play a public multi-track HLS stream (Apple "bipbop advanced" or Shaka demo assets) through a throwaway screen in `react-native-multi-tv-app-sample`, on the Vega Virtual Device and a Fire OS stick.

1. Plays on both from one shared component.
2. Lists audio tracks; switching audio language mid-playback keeps sync (no rebuffer > 1 s).
3. Text-track cue events arrive on Vega (Shaka `cuechange` / custom textDisplayer) — or fall back to scheduler over fetched VTT.
4. Two text tracks visible at once in the kit overlay.
5. Seek to cue start, pause, resume; playbackRate 0.75 works on both.
6. Own HLS (ffmpeg → Shaka Packager) with two audio renditions (roles main / description) and two WebVTT tracks from S3 + CloudFront; repeat 1–5.
7. Optional: two media elements at once on Vega (informational).

Record results in `docs/device-matrix.md` and every rough edge in the apps' `docs/friction/`.
