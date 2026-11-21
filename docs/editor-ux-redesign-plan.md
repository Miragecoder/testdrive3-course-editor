# TD3 Course Editor UX Redesign Plan

## Status

- [x] Phase 1 - App shell / layout refactor
- [x] Phase 2 - Toolbox modes and panel regrouping
- [x] Phase 3 - Map interaction and properties popup
- [x] Phase 4 - Pattern-aware editing
- [x] Phase 5 - Polish and regression pass

## Context

This plan captures the UX redesign direction discussed for the existing Test Drive III Course Editor prototype in this repository.

The goal is to reorganize the editor into a clearer course/leg editing workflow while preserving existing domain behavior (DAT/LST loading, tile editing, entities, routes, sky/horizon, export, etc.).

## Current prototype (as inspected)

Key files:
- `editor.html` - current editor markup
- `src/browser/editor.ts` - main editor logic (~2600 lines)
- `src/browser/editor.css` - editor styling
- `playdisk.html` / `src/browser/playdisk.ts` - separate PLAYDISK.DAT tool

Current UI shape:
- Top bar with links
- Toolbar with course select, leg select, open/export
- Workspace with map panel on the left and inspector panels on the right

Existing functional areas already present:
- Course/leg selection (5 legs per course)
- 32x16 tile grid editing, tile palette, paint mode
- Selected cell editing (tile ID, rotation, elevation)
- Entity/route/waypoint visibility toggles
- Sky & horizon per-leg editing
- Placed entities, route markers, opponent route scripts
- Scene strings / LST metadata
- Reverse Pacific course / SCENE03 generation
- DAT/LST export

## Locked-in decisions

- **Leg count is fixed at 5.** No add/remove/reorder leg UI. Provide clear leg navigation and active-leg context.
- **Scene editor scope is course-leg editing.** Do not turn the scene editor into a general “generate new scene” workspace.
- **`Generate SCENE03` / Reverse Pacific course stays available, but moves outside the scene editor.** It generates a new scene and should be exposed as a course-level tool, not a normal scene-editing inspector panel.
- **`PLAYDISK.DAT` editor remains outside the scene editor.** Keep it as a separate page/tool.
- **Toolbox modes:** `Tiles`, `Entities`, `Routes & AI`, `Leg Properties`.
- **Routes & AI is one category.** Route markers, branch paths, opponent route scripts, route generation, and route validation/overlays belong together.
- **Properties popup interaction:** Left click selects/paints based on active tool; right click selects + opens properties popup; `Esc` closes popup; double-click/Enter may also open properties. Popup input must not trigger map pan/zoom.
- **Highway shield sign generator is stubbed in UI only for now.** No real 3D/object generation pipeline required in the initial implementation.
- **Roadside snap points and tile clusters/prefabs are desired features.** Implement after the core UX shell is stable.
- **Implementation style:** incremental, manageable phases; preserve existing domain behavior; avoid risky big-bang rewrites.

## Target UX

```text
+------------------------------------------------------------------------------------------------------+
| TD3 Course Editor                                 [Course Tools v] [PLAYDISK Editor] [3D Viewer]    |
| Course: [SCENE01 - Pacific Coast v]  Leg: [<] 2 / 5 [>]            [Open DAT] [Export DAT/LST]     |
| Scope: Course > Leg 2                                                                     Unsaved: * |
+----------------------------------+--+----------------------------------------------------------------+
| TOOLBOX (~18%, resizable)   [<<] |R | MAP VIEW                                                      |
| [Tiles][Entities][Routes & AI][Leg Properties] |S | [Paint][Grid][Show Entities][Show Routes][WP]  [-] 125% [+] [Fit] |
|----------------------------------|Z |----------------------------------------------------------------|
| Active mode content              |R |  +----------------------------------------------------------+  |
|                                  |  |  |                      32 x 16 map grid                    |  |
| Tiles: palette, paint, clusters  |  |  |                                                          |  |
| Entities: list, sign stub, snap  |  |  |   +----------------------------------------------+       |  |
| Routes & AI: markers, paths, AI  |  |  |   | Properties popup                        [x] |       |  |
| Leg: sky/horizon, leg settings   |  |  |   | target / fields / Apply / Reset             |       |  |
|                                  |  |  |   +----------------------------------------------+       |  |
| (vertical scroll only)           |  |  +----------------------------------------------------------+  |
+----------------------------------+--+----------------------------------------------------------------+
| SCENE01 > Leg 2/5 > Cell 14,7 > selected item > zoom 125%                         warnings/status  |
+------------------------------------------------------------------------------------------------------+

Course Tools (outside scene editor): Generate reversed SCENE03, other course-generation actions
Separate page: PLAYDISK.DAT editor
```

### Layout behavior

- Left toolbox defaults to ~18% width (or ~280-320px equivalent), resizable, collapsible, with min/max constraints.
- Toolbox scrolls vertically only.
- Map view takes remaining space and scrolls horizontally/vertically as needed.
- Scroll wheel zooms the map to cursor; add explicit pan support (space/middle drag) and zoom controls.
- Course and active leg are always visible in header and/or status bar.

## Toolbox modes and panel mapping

| Mode / area | Contents | Notes |
|---|---|---|
| **Tiles** | Tile palette, tile bank selection, paint controls, future cluster/prefab stamps | Selected cell/tile properties move to map popup. |
| **Entities** | Placed entities list/selection, entity visibility/focus controls, highway shield sign generator stub, future roadside snap options | Entity-specific fields edited via popup/details. |
| **Routes & AI** | Route markers, branch paths, opponent route scripts, generate AI routes, route validation/overlays | Keep all routing/AI concerns together. |
| **Leg Properties** | Sky & horizon, leg-scoped metadata/settings, scene/LST metadata as appropriate, advanced leg actions | Clearly leg-scoped; destructive actions labeled carefully. |
| **Course Tools (outside editor)** | Generate reversed SCENE03 / Reverse Pacific course | Separate from scene-editing workflow because it generates a new scene. |
| **Separate page/tool** | PLAYDISK.DAT editor | Already separate; keep outside scene editor. |

### Mapping from current panels

| Current panel | Target |
|---|---|
| Tile grid / map toggles / zoom | Map view toolbar + map pane |
| Selected cell | Right-click properties popup |
| Tile palette | Tiles mode |
| Sky & horizon | Leg Properties mode |
| Reverse Pacific course | Course Tools (outside scene editor) |
| Scene UI bitmaps | Leg Properties / advanced or course-scoped section; keep scope explicit |
| Placed entities | Entities mode |
| Route markers | Routes & AI mode |
| Opponent route scripts | Routes & AI mode |
| Scene strings (LST) | Leg Properties or clearly labeled scene/course section |
| Working copy | Header/status or advanced/global area |

## Out-of-scope / relocated features

- **No new leg management beyond fixed 5 legs.**
- **No real highway shield 3D generation** in initial phases; UI stub only.
- **No PLAYDISK editor redesign** as part of scene editor phases, except keeping navigation/linking coherent.
- **No SCENE03 generation inside the scene-editing inspector.** Move it to a course-level tool.

## Phased implementation plan

### Phase 1 - App shell / layout refactor
**Goal:** Establish the new layout without changing domain behavior.

**Scope:**
- Refactor `editor.html` structure into header, toolbox pane, map pane, status bar.
- Add split layout/resizer/collapse styles in `editor.css`.
- Keep existing editor logic working by preserving key element IDs/hooks where practical.
- Move `Reverse Pacific course` UI out of the normal inspector flow into a `Course Tools` area/menu/dialog outside scene-editing modes.
- Keep PLAYDISK link visible but separate.

**Verification:**
- Editor loads, course/leg selection works.
- Tile map renders and existing edit/export flows still work.
- Reverse Pacific course remains accessible, but not inside the scene-editing toolbox modes.
- PLAYDISK editor remains reachable.

**Done when:** New shell is in place and no core editor regression is introduced.

### Phase 2 - Toolbox modes and panel regrouping
**Goal:** Organize existing panels into the four toolbox modes.

**Scope:**
- Add toolbox mode state (`tiles`, `entities`, `routes-ai`, `leg-properties`).
- Regroup existing panels according to the mapping table.
- Add clear section labels and leg/course scope cues.
- Add highway shield sign generator stub UI in Entities mode (disabled/placeholder behavior is acceptable).

**Verification:**
- Mode switching works and preserves relevant state.
- Existing tile/entity/route/horizon/LST functionality is still accessible.
- No duplicate/confusing ownership for route markers vs route scripts.

**Done when:** All existing scene-editing panels are reachable in the new mode structure.

### Phase 3 - Map interaction and properties popup
**Goal:** Make the map the primary editing canvas.

**Scope:**
- Implement scroll-wheel zoom-to-cursor, pan support, zoom percentage/fit/reset controls.
- Move selected cell/entity/marker properties into a right-click popup overlay on the map.
- Support right-click select+open, double-click/Enter open, `Esc` close, click-outside behavior that does not accidentally mutate state.
- Isolate popup keyboard/scroll input from map interactions.

**Verification:**
- Paint/select workflows still work.
- Zoom/pan feels stable and does not fight popup interaction.
- Properties popup edits apply/reset correctly for supported targets.

**Done when:** Fixed selected-cell inspector is replaced by contextual popup without losing editing capability.

### Phase 4 - Pattern-aware editing
**Goal:** Add high-value editing accelerators.

**Scope:**
- **Tile clusters/prefabs:** initial tile-only multi-cell stamps, ghost preview, single undo step, overwrite/bounds checks, create from selection.
- **Roadside snap points:** snap toggle, candidate anchors/presets, free placement fallback.
- **Highway shield sign generator:** keep as stub UI unless data model is clarified; only implement real generation if it becomes trivial and safe.

**Verification:**
- Cluster placement is atomic in undo/redo.
- Snap mode improves placement but does not block manual placement.
- Stubbed generator is clearly labeled as not yet implemented if non-functional.

**Done when:** Pattern-aware tools are usable or clearly stubbed without harming core workflows.

### Phase 5 - Polish and regression pass
**Goal:** Make the editor cohesive and reliable.

**Scope:**
- Keyboard shortcuts, tooltips, status bar details, dirty-state cues, validation/warning surfacing.
- Visual polish for toolbox/map/popup consistency.
- Cleanup dead CSS/markup/handlers from old layout.
- Regression pass for core flows.

**Verification:**
- Open/load DAT, switch course/leg, edit tiles, edit entities, edit routes/AI, edit sky/horizon, export DAT/LST.
- Course Tools and PLAYDISK navigation work.
- No obvious layout overflow/focus/scroll regressions.

**Done when:** The redesigned editor is stable enough for regular use and further iteration.

## Risks and notes

- **`editor.ts` coupling:** The current editor logic is concentrated in a large file with DOM-coupled state. Prefer incremental extraction/refactor only where it reduces risk.
- **Routes & AI ownership:** Route markers are map items but conceptually belong with Routes & AI. Keep one canonical editing home; avoid duplicate conflicting controls.
- **Course vs leg scope:** Keep labels explicit. Sky/horizon is leg-scoped; SCENE03 generation is course-generation scoped and outside scene editing.
- **Pattern features need data rules:** Roadside snap points and tile clusters should be grounded in existing SCENE01/SCENE02 patterns/data where possible.
- **Sign generator data model unknown:** Treat as UI stub until the expected output (asset/entity/variant) is defined.

## Phase 1 completion notes

**Completed (2026-11-21):**
- Refactored `editor.html` into the new shell: top bar, course controls toolbar, toolbox pane (left), resizer, map pane (right), and status footer.
- Moved the Reverse Pacific course / SCENE03 generation UI out of the inspector flow into a `Course Tools` dialog in the header (outside scene-editing modes). PLAYDISK remains a separate top-bar link.
- Added split layout/resizer/collapse behavior in `src/browser/editor.css` and minimal shell wiring in `src/browser/editor.ts` (`initEditorShell`): toolbox collapse/expand, pointer/keyboard resizer, Course Tools dialog open/close.
- Preserved existing DOM IDs/hooks used by editor logic; no domain behavior changes intended.

**Verification performed:**
- Static ID check: all `requiredElement(...)` IDs referenced by `src/browser/editor.ts` are present in `editor.html`; new shell IDs present.
- `npm run build` / `npm run typecheck` **not run**: Node/npm are not available in this sandbox environment (`npm: command not found`). Manual static review of HTML/CSS/TS changes performed instead.

**Follow-ups / Phase 2 notes:**
- Phase 2 should add toolbox mode state (`tiles`, `entities`, `routes-ai`, `leg-properties`) and regroup existing panels into those modes; the toolbox body currently contains all panels in a single scrollable column.
- Consider persisting toolbox width/collapse state (localStorage) if desired; currently resets on reload.
- The Course Tools dialog uses native `<dialog>`; verify focus/ESC behavior across browsers during Phase 5 polish.
- Run `npm run build` in a Node-enabled environment to confirm typecheck/build before shipping.

## Phase 2 completion notes

**Completed (2026-11-21):**
- Added toolbox mode tabs and mode state in `editor.html`/`src/browser/editor.ts`: `Tiles`, `Entities`, `Routes & AI`, `Leg Props` (`tiles`, `entities`, `routes-ai`, `leg-properties`). Tab switching updates ARIA state and shows only the active mode panel.
- Regrouped existing scene-editing panels into the four modes per the mapping table:
  - **Tiles:** Selected cell, Tile palette (selected-cell popup deferred to Phase 3).
  - **Entities:** Placed entities, Highway shield sign generator stub (disabled placeholder, clearly labeled not implemented).
  - **Routes & AI:** Route markers and Opponent route scripts/route generation/validation together (no duplicate ownership).
  - **Leg Properties:** Sky & horizon (Leg), Scene UI bitmaps (Course/scene), Scene strings/LST (Course/scene), Working copy (Global).
- Added clear leg/course scope cues: per-mode scope banners and panel scope badges. Preserved all existing DOM IDs/hooks and editor event wiring; no domain behavior changes intended.
- Kept PLAYDISK.DAT editor and SCENE03/Course Tools outside the scene-editing toolbox (unchanged from Phase 1).

**Verification performed:**
- Static ID check: all `requiredElement(...)` and `getElementById(...)` IDs referenced by `src/browser/editor.ts` are present in `editor.html`.
- `npm run build` / `npm run typecheck` **not run**: Node/npm are not available in this sandbox environment (`node`/`npm` not found). Manual static review of HTML/CSS/TS changes performed instead.

**Follow-ups / Phase 3 notes:**
- Phase 3 should move Selected cell/tile properties into a right-click properties popup on the map, while keeping tile palette in Tiles mode.
- Map paint/entity/route overlay toggles remain in the map toolbar; consider whether paint controls should also be surfaced in Tiles mode during Phase 3/5 polish.
- Toolbox mode is currently in-memory only (resets on reload). Consider persisting active mode/width/collapse state in localStorage if desired.
- Run `npm run build` in a Node-enabled environment to confirm typecheck/build before shipping.

## Phase 3 completion notes

**Completed (2026-11-21):**
- Added map interaction controls in `editor.html`/`src/browser/editor.ts`/`src/browser/editor.css`: scroll-wheel zoom-to-cursor, space/middle-drag pan, zoom in/out/fit/reset controls, and zoom percentage display.
- Moved selected cell properties into a right-click properties popup overlay on the map. The popup reuses the existing cell form IDs (`cell-details`, `tile-id`, `tile-rotation`, `tile-elevation`, `apply-cell`, `reset-cell`) so existing editor wiring continues to work.
- Moved entity details into the same contextual popup (`entity-details` preserved). Entity list selection, entity marker left-click selection, right-click/double-click/Enter open the entity popup; marker selection state remains synchronized.
- Implemented popup interactions per plan: left click selects/paints based on active tool; right click selects + opens popup; double-click/Enter open popup; `Esc` closes popup; click-outside closes popup and suppresses accidental cell/entity mutation. Popup pointer/wheel input is isolated from map pan/zoom.
- Removed fixed Selected cell / entity detail panels from toolbox modes and replaced them with short hints; tile palette remains in Tiles mode. Kept PLAYDISK and SCENE03/Course Tools outside the scene-editing toolbox.

**Verification performed:**
- Static checks: `grep`/`awk`/`comm` verified all `requiredElement(...)`/`getElementById(...)` IDs referenced by `src/browser/editor.ts` exist in `editor.html`, and no duplicate HTML IDs were found.
- `npm run build` / `npm run typecheck` **not run**: Node/npm are unavailable in this sandbox (`env: 'node': No such file or directory`; `node_modules/.bin/tsc` present but cannot execute without Node). Manual static review of changed HTML/CSS/TS performed.

**Follow-ups / Phase 4 notes:**
- Popup currently supports cell and entity targets; route-marker/route-decision properties could be added as contextual targets if needed, but route marker editing remains available in Routes & AI.
- Click-outside closes the popup and suppresses the next cell/entity marker click to avoid accidental mutation; consider a softer behavior if UX feedback prefers selection changes.
- Pan uses Space+drag and middle-drag; touch/mobile pan behavior and pointer capture edge cases should be checked during Phase 5 polish.
- Run `npm run build` / `npm run typecheck` in a Node-enabled environment before shipping.

## Phase 4 completion notes

**Completed (2026-11-21):**
- Added **Tile clusters/prefabs** in Tiles mode (`editor.html`, `src/browser/editor.ts`, `src/browser/editor.css`): in-memory cluster library with built-in same-tile templates and captured clusters, capture from anchor→selected rectangular region (Shift+click extends selection), armed cluster stamp mode with hover ghost preview, out-of-bounds stamp blocking, and single-step undo for the last cluster stamp (button + Ctrl/Cmd+Z when not in a text input). Cluster stamps are tile-only (tile ID, rotation, elevation) and apply as one action.
- Added **Roadside snap points** in Entities mode: snap toggle, preset anchors (nearest lane roadside from lane connectivity, cell center, north/east/south/west roadside, free placement fallback), "Move selected entity on map click" toggle, and actions to snap the selected entity in place or move it to the selected cell. Entity moves update world X/Z and cell fields and preserve existing entity editing behavior.
- Kept **Highway shield sign generator** as a clearly labeled stub UI only (no real 3D/object generation). PLAYDISK.DAT editor and SCENE03/Course Tools remain outside the scene-editing toolbox.

**Verification performed:**
- Static ID check: all `requiredElement(...)`/`getElementById(...)` IDs referenced by `src/browser/editor.ts` exist in `editor.html`; no duplicate HTML IDs found; all 14 new Phase 4 control IDs present.
- `npm run build` / `npm run typecheck` **not run**: Node/npm are unavailable in this sandbox (`node`/`npm` not found in PATH). Manual static review of changed HTML/CSS/TS performed, including unused-local scan for newly added functions.

**Follow-ups / Phase 5 notes:**
- Cluster ghost preview currently highlights target cells; it does not render tile preview thumbnails inside the ghost. Consider richer preview and drag-to-stamp behavior during Phase 5 polish if desired.
- Cluster library is session-only and resets on reload; consider localStorage persistence/import-export in a later phase.
- Roadside snap presets are heuristic (cell offsets and lane-side-based nearest roadside). They improve placement but do not block manual/free placement; validate against real SCENE01/SCENE02 roadside object patterns during Phase 5.
- `entity-move-on-click` is a global toggle while enabled; consider scoping it more explicitly to Entities mode or adding stronger visual affordance during Phase 5 polish.
- Run `npm run build` / `npm run typecheck` in a Node-enabled environment before shipping.

## Phase 5 completion notes

**Completed (2026-11-21):**
- **Keyboard shortcuts & tooltips:** Added global shortcuts (when not typing in inputs/dialogs): `1`–`4` switch toolbox modes, `+`/`=` zoom in, `-` zoom out, `0` reset zoom, `F` fit map, `Enter` open properties for selected cell/entity, `Esc` close properties popup, `Ctrl/Cmd+Z` undo last cluster stamp. Added tooltips/title hints to toolbox tabs, source/leg selects, open/export buttons, map zoom controls, paint toggle, and documented shortcuts in the footer notice.
- **Status bar details & dirty-state cues:** Reworked status footer into context + message areas. Context shows source file, active leg, selected cell, selected target, zoom, and validation warnings. Added a toolbar `Unsaved changes` indicator driven by full DAT/LST byte comparison against original working copies; status context updates on selection, zoom, leg, and data changes.
- **Validation/warning surfacing:** Surfaced horizon gradient banding warnings and SCENE03 route-validation reminder in status context while preserving existing panel-specific feedback (horizon preview warning, route/LST/cluster/entity feedback).
- **Visual polish & cleanup:** Polished status/footer styling for readability and error emphasis, kept popup/toolbox/map styling consistent, and added modal-dialog guard to avoid global shortcuts firing over course-tools dialog. No PLAYDISK or SCENE03 generation was moved into the scene-editing toolbox; existing editor behavior preserved incrementally.
- **Regression pass:** Performed static regression review of core flow wiring (load/open, course/leg selection, tile paint/select, properties popup, entity/route/LST/horizon controls, export/reset handlers, toolbox shell). No Node runtime available for runtime build smoke test.

**Verification performed:**
- Static ID checks: `requiredElement(...)` and `getElementById(...)` IDs referenced by `src/browser/editor.ts` exist in `editor.html`; no duplicate HTML IDs found.
- `npm run typecheck` / `npm run build` **not run**: `node`/`npm` unavailable in this sandbox (`node: command not found`); `node_modules/.bin/tsc` present but cannot execute without Node. Manual static review of changed HTML/CSS/TS performed.

**Follow-ups:**
- Run `npm run typecheck` and `npm run build` in a Node-enabled environment before shipping.
- Consider persisting toolbox mode/width/collapse and cluster library in localStorage.
- Cluster ghost preview is still highlight-only; richer tile-preview ghosts/drag-stamp would improve Phase 4 UX.
- Roadside snap presets remain heuristic; validate against SCENE01/SCENE02 patterns and consider stronger affordance/scope for "Move selected entity on map click".
- If keyboard shortcuts grow, add a small in-app shortcuts/help overlay and audit focus trapping across browsers for the native `<dialog>` course tools.

## Pickup instructions for future sessions

When starting a new session, use a prompt like:

```text
In /home/rob/opencode/td3-analysis-docs/repos/testdrive3-course-editor, read docs/editor-ux-redesign-plan.md.
Implement Phase N only from that plan.
Preserve existing editor behavior, keep changes incremental, and do not move PLAYDISK or SCENE03 generation into the scene-editing toolbox.
When done, update the Status checklist and add brief notes to the plan doc about what was completed, what was verified, and any follow-ups.
```

Before coding in a follow-up session:
- Read `docs/editor-ux-redesign-plan.md`.
- Inspect current `editor.html`, `src/browser/editor.ts`, and `src/browser/editor.css`.
- Confirm which phase is next and limit scope to that phase.
- Run relevant checks/builds for the prototype after changes (at minimum the project’s normal build/typecheck if feasible).
- Leave the editor in a working state; do not mix unrelated refactors.
