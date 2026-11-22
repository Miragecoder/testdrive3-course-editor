# Title/Icon Variable Size (Recomposition on Export)

## Key insights (from reverse engineering / engine behavior)

- **LST archive directory controls pointers for archived/named assets.** The scene `.LST` contains an archive directory table (entries: hash, archive id, offset, size). For resources loaded via `archive_open` (name-hash lookup), the engine reads from the DAT at the **offset/size stored in the LST**. So for LST-archived entries, resizing/moving is possible **if** the LST entry is updated (and later archived entries shifted if bytes move).
- **Fixed-layout regions also exist.** Many DAT regions (maps, tile geometry, palettes/landscapes/sprite banks in documented fixed ranges) are treated as fixed offsets by the engine/tools per `spec/dat-file-layouts.md` / `spec/map-format.md`. Shifting these breaks the unmodified engine.
- **SCENE01 vs SCENE02 have different offsets/layouts.** Even similar region types appear at different absolute offsets/sizes between scenes; there is no single shared offset map across scenes.
- **Title/icon in practice:** menu/scene icon loading goes through the archived/name path (`.ICN` via archive lookup), so title/icon assets in that packaged context are effectively LST-archived — allowing size changes when the LST archive entry (and any shifted later archived entries) are updated correctly.

## What the editor does now

- **Override model for title/icon:** Generate from text and file Replace/Fit for `title`/`icon` store encoded overrides in memory (no in-place mutation of the working DAT blob for these slots).
- **Recomposition on export:** `Export scene (DAT+LST)` rebuilds the DAT from the current working base by splicing title/icon overrides (handling size deltas), updates matching LST archive entries at those offsets, shifts later LST archive entries, then downloads DAT and LST together.
- **Caveat:** expanding regions near the start of scene DATs shifts subsequent bytes; this can break fixed-offset engine reads for non-archived regions. Test in-game after changes.

## Practical workflow

1. Load a scene (with its `.LST`) in the Course Editor.
2. Edit `title`/`icon` via Generate from text or Replace/Fit (larger sizes are allowed; overrides are marked in the UI).
3. Export **DAT+LST together**.
4. Use the exported package with the original/unmodified engine.
