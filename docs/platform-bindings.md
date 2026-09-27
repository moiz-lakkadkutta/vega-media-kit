# Platform bindings

The Vega column is the intended backing and is **not implemented**: on Vega every binding is a no-op today (KIT-007 deferred, Vega experimental — [decision 0001](decisions/0001-week0-gates.md)), and those no-ops are silent until KIT-018.

| Module | Vega (planned, KIT-007) | Fire OS |
|---|---|---|
| `contentLauncher.registerCatalog / onLaunchIntent / onTransportControl` | Vega Content Launcher (verify in VVD with `journalctl` per Amazon's content-launcher-testing doc) | Catalog integration is a submission-time process; runtime no-op that logs the deep-link shape |
| `personalization.reportPlayback / setWatchlist` | Vega Content Personalization | no-op (warn once) |
| `mediaControls.setNowPlaying / onControl` | VegaMediaControl | Android MediaSession via react-native-video; extend with a native module if needed |
| `parentalControls.isRestricted / requestPin` | Vega Parental Controls (VVD ≥ 0.24) | no-op (system PIN) |
| `useRemote` | RNV key events | Android TV key events |

Every no-op on Fire OS and web logs once at debug level with a link here; on Vega they do not yet (KIT-018). Those logs are the raw material for the hackathon's product-feedback section.
