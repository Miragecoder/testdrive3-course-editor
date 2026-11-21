# TD3 Course Editor UX Redesign Plan

## Status

- [x] Phase 1 - App shell / layout refactor
- [x] Phase 2 - Toolbox modes and panel regrouping
- [ ] Phase 3 - Map interaction and properties popup
- [ ] Phase 4 - Pattern-aware editing
- [ ] Phase 5 - Polish and regression pass

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
