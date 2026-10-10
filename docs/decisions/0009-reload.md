# 0009 — `reload()`: a load is identified by uri + generation

**Date:** 2026-10-10
**Status:** accepted — decided by the human 2026-10-10 ("go with recommendation": KIT-035 option A + D2); amends 0005 §1 and §4
**Tickets:** KIT-035 · **Plan:** `docs/plans/KIT-035-retry.md`

## Context

After a fatal error (`MEDIA` on web, `EXO` on Fire OS, `SHAKA_*` on Vega) an app cannot retry the same uri: the
source-change reset is keyed on `uri` (0005 §1), so setting the same source again does nothing, and `ref.play()` on a
failed web load rejects with `NotSupportedError`, which the adapter swallows — nothing happens and nothing is reported.
`described` works around it by remounting with `key={attempt}`; `lingo` has no `onError` at all.

Every per-source gate in `KitPlayer` (`handleError`, `handleTracks`, `handleState`, `handleTextTrackData`) closes over
`sourceUri`. On a same-uri retry those handlers are not even re-created, so a late report from the failed load would
be attributed to the retry.

## Decision

1. **`KitPlayerRef.reload(): void`** runs the full 0005 §2 reset and starts a new load of the *same* uri on every
   adapter. It is the only new way to start a load.
2. **A load is identified by `loadKey = `${generation}:${uri}``.** `generation` is KitPlayer state bumped only by
   `reload()`. The reset, every origin gate, the adapters' load effects (via an internal `AdapterProps.loadKey`) and
   Fire OS's `<Video key>` key on it. Amends 0005 §1: "a source change is a change of `uri`" → "a new load is a change
   of `uri` or a `reload()`". `headers`/`type` still do not count.
3. **Amends 0005 §4.** The numeric generation rejected there is adopted for the same-uri case. The objection was that
   it only distinguishes A→B→A, which delivers the same bytes. A same-uri retry is a case the uri cannot distinguish,
   and there the old load's reports (its errors, its `ready`) are wrong. `generation` is **not** bumped on a uri change,
   so the A→B→A known limit stands.
4. **`play()` on a failed load (D2):** the kit reports one non-fatal `PLAY_REJECTED` ("call reload() to retry") and
   does not forward the call to the adapter. `play()` never reloads implicitly (option C rejected: it hides a reload
   behind `play` and restarts from a surprising position).
5. **Docs:** `docs/getting-started.md` names the alternatives — retry with a new uri (cache-buster, also the answer
   to a CDN that caches the 404) or remount with `key={attempt}`.

## Consequences

- Public API change (`KitPlayerRef.reload`): **minor** changeset. `described`'s test stub (`test/stubs/kit.tsx`) needs
  a `reload` member — an app ticket. `described` may then replace its remount retry; `lingo` should add `onError`.
- Land after KIT-034 (both edit `fireos.tsx`, `vega.tsx` and the error/state gates). A reload must start a new Fire OS
  load record, clearing KIT-034's `failed` flag.
- KIT-038 adds position-reset lines to the switch reset; the reload reset must include them.
