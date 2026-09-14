# Cue overlay

Defaults (px at 1920×1080): inset 96/54 (5 % safe zone), primary 44 / secondary 32, line-height 1.3, ≤ 2 lines, text `#F1F1F1` on `rgba(0,0,0,.65)`, radius 6, min display 0.833 s.

- `primaryTrackId`: which track renders large; other active tracks render as secondary lines above (Lingo's native line).
- `hideSecondary`: Lingo "Challenge" mode.
- `selectable={{ focusedIndex, onFocusWord }}`: word-level focus for D-pad navigation while paused.
- `line: 'top'` cues render at the top (Netflix convention when burnt-in text would be covered).
- Speakers render as `[Name] `; sound cues as `[sound]`; `<i>`/`<b>` preserved.
- Pass `theme.fontFamily` (Described: Atkinson Hyperlegible; Lingo: Noto Sans) and `theme.userScale` (1–2).
