# examples/vega-min

Minimal React Native for Vega app that plays a public multi-track HLS stream through `KitPlayer` and renders two text tracks with `CueOverlay`.

Generate the project with the Vega CLI (it must be created on a machine with the Vega SDK):

```
vega project create vega-min --template hello-world   # name may differ per SDK version; see Amazon's docs
cd vega-min && pnpm add @moizp/vega-media-kit
# copy App.tsx from ./App.tsx and follow vega-video-sample's post-install to vendor Shaka
vega virtual-device start && vega run-app build/aarch64-release/vega-min_aarch64.vpkg
```
