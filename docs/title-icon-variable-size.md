# Scene Image Variable Size (Recomposition on Export)

## Key insights (from reverse engineering / engine behavior)

- **LST archive directory controls pointers for archived/named assets.** The scene `.LST` contains an archive directory table (entries: hash, archive id, offset, size). For resources loaded via `archive_open` (name-hash lookup), the engine reads from the DAT at the **offset/size stored in the LST**. So for LST-archived entries, resizing/moving is possible **if** the LST entry is updated (and later archived entries shifted if bytes move).
- **Fixed-layout regions also exist.** Many DAT regions (maps, tile geometry, palettes/landscapes/sprite banks in documented fixed ranges) are treated as fixed offsets by the engine/tools per `spec/dat-file-layouts.md` / `spec/map-format.md`. Shifting these breaks the unmodified engine.
- **SCENE01 vs SCENE02 have different offsets/layouts.** Even similar region types appear at different absolute offsets/sizes between scenes; there is no single shared offset map across scenes.
- **LST-archived scene images:** title/icon and landA–F landscape images are present as LST archive entries, so they can be resized when the matching LST archive entry (and any shifted later archived entries) are updated correctly.

## What the editor does now

- **Override model for scene images:** Replace/Fit for scene image slots (`title`, `icon`, `landA`–`landF`) stores encoded overrides in memory (no in-place mutation of the working DAT blob for these slots). Title/icon can also be generated from text.
- **Recomposition on export:** `Export scene (DAT+LST)` rebuilds the DAT from the current working base by splicing all scene image overrides in offset order (handling size deltas), updates matching LST archive entries at those offsets, shifts later LST archive entries by cumulative delta, then downloads DAT and LST together.
- **Caveat:** expanding regions shifts subsequent bytes; this can break fixed-offset engine reads for non-archived regions. Test in-game after changes.

## Practical workflow

1. Load a scene (with its `.LST`) in the Course Editor.
2. Edit a scene image slot via Replace/Fit (or Generate from text for title/icon). Larger sizes are allowed; overrides are marked in the UI.
3. Export **DAT+LST together**.
4. Use the exported package with the original/unmodified engine.
