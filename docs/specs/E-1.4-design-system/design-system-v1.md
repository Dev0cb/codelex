# E-1.4 Design system v1 and board renderer — thin spec (sprint task D5)

- Epic: E-1.4 · Status: **Ready for implementation (thin v1)** · Owner: `ux-ui-designer` · Last update: 2026-10-03
- Consumers: slice **S1** (first playable: board, rack, PLAY vs a bot) and app scaffolds **A1** (`apps/mobile`,
  `packages/design-system`). Implementers: `mobile-engineer` (renderer, components), `frontend-web-engineer` (token
  build for web, later).
- Scope: just enough for S1 and A1. **Not** a full design system: no web components, no Storybook beyond a token
  gallery, no illustration/icon-set authoring, no Coach marks, Segmented, ResultHeader, BreakdownList, BotAvatar
  (all deferred to the slice that needs them).
- **Source of truth for every product decision is `docs/specs/E-1.5-play-vs-bot/classic-match-vs-bot.design.md`**
  (cited as _E-1.5_). This document reuses its tokens (E-1.5 section 7), camera (5.5.2), a11y (9) and motion (8). It
  adds only: light-theme values, the token file layout, the renderer contract and the S1 component states. Where a
  number differs inside E-1.5 itself, section 1.3 below picks one.
- Assumptions are marked **[A-n]** and collected in section 9.

## 1. Design tokens

### 1.1 Format and files (assumption [A-1])

W3C-DTCG style (`{ "$value", "$type" }`), dot paths as in E-1.5 section 7, one JSON file per group under
`packages/design-system/tokens/`: `color.json` (with `dark` and `light` modes), `type.json`, `space.json`,
`radius.json`, `elevation.json`, `motion.json`, `layout.json`. A build step (A1) emits `dist/tokens.ts` (typed
constants, flat camelCase keys, e.g. `color.bg.base` -> `tokens.color.bgBase`) and later `tokens.css` for web. Code
never contains a literal colour, size or duration outside this package. A unit test fails the build when a token has
no value in both modes.

### 1.2 Colour roles

Dark is the default and the brand reference (values are exactly E-1.5 7.1). Light is new in this spec **[A-2]**:
derived to keep the same roles and contrast targets; it ships in S1 because it only costs a second column, but the
Settings theme picker is **not** in S1 (theme follows the OS; dark when unknown). Contrast is verified by a script
(`pnpm --filter design-system contrast`) in A1: text >= 4.5:1, UI shapes >= 3:1 on the surface they sit on, in both
modes; colour-blind simulation is a release check, not an S1 blocker.

| Token                                                                                         | Role                                                  | Dark              | Light **[A-2]**         |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------- | ----------------------- |
| `color.bg.base`                                                                               | App background                                        | #0B0F14           | #F6F8FA                 |
| `color.bg.surface`                                                                            | Cards, sheets                                         | #121923           | #FFFFFF                 |
| `color.bg.raised`                                                                             | Raised or selected surface                            | #1A2330           | #EAEFF4                 |
| `color.border.subtle`                                                                         | 1 dp borders                                          | #2A3646           | #C9D3DE                 |
| `color.text.primary`                                                                          | Text                                                  | #E6EDF3           | #101820                 |
| `color.text.muted`                                                                            | Secondary text                                        | #9AA7B4           | #4A5764                 |
| `color.accent.primary`                                                                        | Primary button, selection, pending border, focus ring | #22D3A6           | #00876A                 |
| `color.accent.onPrimary`                                                                      | Text/icon on primary                                  | #04130F           | #FFFFFF                 |
| `color.feedback.error`                                                                        | Rejection (icon + text always)                        | #FF7A7A           | #B3261E                 |
| `color.feedback.warning`                                                                      | Scoreless warning, low storage                        | #FFC857           | #8A5A00                 |
| `color.feedback.info`                                                                         | Notices                                               | #6CB6FF           | #0B63B8                 |
| `color.scrim`                                                                                 | Sheet scrim                                           | rgba(0,0,0,.60)   | rgba(16,24,32,.40)      |
| `color.board.bg`                                                                              | Board background                                      | #0F151D           | #DDE4EB                 |
| `color.board.grid`                                                                            | Square borders                                        | #1E2937           | #B8C4D0                 |
| `color.board.lastMove`                                                                        | 2 dp ring on last-move tiles                          | #FFFFFF           | #101820                 |
| `color.tile.face`                                                                             | Tile face (all tile states)                           | #F1E9D2           | #F1E9D2                 |
| `color.tile.ink`                                                                              | Tile letter                                           | #121821           | #121821                 |
| `color.tile.value`                                                                            | Tile value                                            | #4A4F57           | #4A4F57                 |
| `color.tile.blankOutline`                                                                     | Blank dotted outline                                  | #8C8570           | #6E6753                 |
| `color.tile.pendingBorder`                                                                    | = `accent.primary`                                    | alias             | alias                   |
| `color.premium.dl` / `.tl`                                                                    | Double / triple letter                                | #56B4E9 / #3D7DD9 | #1F7FB8 / #1F58B5       |
| `color.premium.dw` / `.tw`                                                                    | Double / triple word                                  | #E69F00 / #E8590C | #A66A00 / #C2410C       |
| `color.premium.*.tint`                                                                        | Square fill = colour at 22 % over `board.bg`          | derived           | derived                 |
| `color.premium.label`                                                                         | Premium text label                                    | #E6EDF3           | #101820                 |
| `color.category.{programming,systems,networking,cloud,devops,data,ai,cybersecurity,hardware}` | Category hue (chips, badges)                          | E-1.5 7.1         | darkened 25 % **[A-2]** |

Tile faces are the same ivory in both modes (a tile is a physical object; it keeps >= 12:1 ink contrast and is
instantly recognisable). Reserved, not rendered in S1: `color.tech.*` (tech squares are off in the playtest).
Category icons and shape badges are the E-1.5 7.1 table; hue never carries meaning alone.

### 1.3 Reconciling E-1.5 internal numbers (decision)

| Item          | E-1.5 says                                            | **v1 uses**                    | Reason                                                            |
| ------------- | ----------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------- |
| Focus zoom    | 2.1x (D-1) and 2.15 (4.1, 5.5.2, `layout.focus.zoom`) | **2.15** (`layout.focus.zoom`) | Guarantees >= 49 dp squares (48.1 at 2.1 breaks the 48 dp target) |
| Overview cell | 23.5 dp (summary) and 22.9 dp (4.1)                   | **344 / 15 = 22.93 dp**        | Board is 344 dp wide with 8 dp margins                            |
| Zoom clamp    | 1.0 to 2.5                                            | **1.0 to 2.5**                 | unchanged                                                         |

### 1.4 Typography (E-1.5 7.2, unchanged)

System UI font (SF / Roboto); JetBrains Mono 500 and 700, Latin subset, bundled (D-28). Sizes in sp, line height in dp.

| Token                                       | Family | Size / line                          | Weight              |
| ------------------------------------------- | ------ | ------------------------------------ | ------------------- |
| `type.display`                              | system | 32 / 40                              | 700                 |
| `type.title`                                | system | 24 / 32                              | 700                 |
| `type.heading`                              | system | 20 / 28                              | 600                 |
| `type.body.l` / `type.body` / `type.body.s` | system | 18 / 26 · 16 / 24 · 14 / 20          | 400                 |
| `type.caption`                              | system | 12 / 16                              | 500                 |
| `type.mono.score`                           | mono   | 24 / 32 (top bar), 40 / 48 (Summary) | 700, tabular digits |
| `type.mono.term`                            | mono   | 24 / 32                              | 700                 |
| `type.tile.letter.{overview,rack,focus}`    | mono   | 14 · 24 · 28                         | 700                 |
| `type.tile.value.{overview,rack,focus}`     | mono   | 8 · 11 · 11                          | 500                 |
| `type.premium.label.{overview,focus}`       | mono   | 9 · 12                               | 700                 |

Scaling: `type.*` honours OS font scale up to 2.0; `type.tile.*` and `type.premium.label.*` cap at 1.3
(`maxFontSizeMultiplier` is set by the token consumer, never ad hoc). For Skia text, size = token size x min(scale, 1.3).

### 1.5 Spacing, radii, elevation, layout (E-1.5 7.3, unchanged)

| Group         | Tokens (dp)                                                                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `space.0..8`  | 0, 2, 4, 8, 12, 16, 24, 32, 48 (4 dp grid; `space.1` = 2 is the only off-grid step, used for rack gaps)                                                         |
| `layout.*`    | `margin.match` 8 · `margin.screen` 16 · `touch.min` 48 · `board.overview` 344 · `tile.rack` 48 x 56 · `rack.gap` 2 · `focus.zoom` 2.15 · `content.maxWidth` 480 |
| `radius.*`    | `tile` 6 · `square` 3 · `button` 14 · `card` 16 · `sheet` 20 · `chip` 999                                                                                       |
| `elevation.*` | `0` flat · `1` surface + 1 dp border, no shadow in dark · `2` pending tile: 4 dp lift, shadow rgba(0,0,0,.5) · `3` dragged tile: 8 dp lift · `sheet` scrim      |

In light mode elevation 1 uses a 1 dp shadow rgba(16,24,32,.12) instead of border-only **[A-3]**.

### 1.6 Motion tokens (E-1.5 7.4, unchanged)

| Token                                                           | Value                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------- |
| `motion.duration.instant` / `fast` / `base` / `camera` / `slow` | 0 / 120 / 200 / 240 / 320 ms                                   |
| `motion.duration.scoreCount`                                    | 400 ms (top bar), 600 ms (Summary)                             |
| `motion.duration.scorePop`                                      | 600 ms                                                         |
| `motion.duration.confirm`                                       | 1500 ms (confirmations only; information never auto-dismisses) |
| `motion.ease.standard`                                          | cubic-bezier(0.2, 0, 0, 1)                                     |
| `motion.ease.decelerate` / `accelerate`                         | cubic-bezier(0.05, 0.7, 0.1, 1) / cubic-bezier(0.3, 0, 1, 1)   |
| `motion.spring.tile`                                            | damping 18, stiffness 220, mass 1 (Reanimated `withSpring`)    |
| `motion.reduced.crossfade`                                      | 150 ms                                                         |

## 2. Board renderer contract (`react-native-skia`)

Package location **[A-4]**: `packages/design-system/src/board/` exports `<BoardView/>` (Skia canvas + gesture layer +
accessibility layer). It is **presentational**: it holds no game rules and never imports `game-engine`. The app maps
engine state to props; legality, scoring and previews come from the engine (principle 1 and 2 of CLAUDE.md).

### 2.1 Inputs (props)

```ts
type Premium = "DL" | "TL" | "DW" | "TW" | "START"; // layout data, not computed here
interface SquareView {
  row: number;
  col: number;
  premium?: Premium; // 0-based, row 0 = top
  tile?: {
    letter: string;
    value: number;
    isBlank: boolean;
    byPlayer: "you" | "opponent";
  };
} // committed
interface PendingView {
  row: number;
  col: number;
  letter: string;
  value: number;
  isBlank: boolean;
  rackIndex: number;
}
interface Highlights {
  lastMove?: ReadonlyArray<{ row: number; col: number }>; // ring, first tile gets a notch
  rejected?: ReadonlyArray<ReadonlyArray<{ row: number; col: number }>>; // dashed outline + "!" at word start
  dropTarget?: { row: number; col: number } | null; // while dragging: outline + corner chevron
}
interface CameraState {
  zoom: number;
  centre: { x: number; y: number };
} // zoom 1.0..2.5, centre in board dp (0..344)
interface BoardViewProps {
  size: 15; // fixed in v1; renderer asserts, no other board sizes
  squares: ReadonlyArray<SquareView>; // 225 entries, row-major; premium from layout `classic-v1`
  pending: ReadonlyArray<PendingView>;
  highlights: Highlights;
  camera: CameraState; // controlled; the app owns the smart-camera policy (E-1.5 5.5.2)
  armedTile: boolean; // a rack tile is selected: taps target squares
  dragging: {
    rackIndex: number | null;
    pendingAt: { row: number; col: number } | null;
    pointer: { x: number; y: number };
  } | null;
  theme: "dark" | "light";
  motion: "full" | "reduced"; // resolved by the app from OS + Settings (D-22)
  a11yMode: "off" | "screenReader"; // app passes true when a screen reader or switch tool is active
  labels: BoardA11yLabels; // pre-translated strings/formatters (section 2.5); no strings in the renderer
  textScale: number; // already capped for Skia text (1.3)
}
```

Camera is **controlled**: the renderer applies the transform and reports gestures; the app (store reducer) decides the
next `CameraState`, including the 240 ms animation (driven by a Reanimated shared value passed in so the transform
stays on the UI thread) and the "manual gesture suppresses auto-move for 2 s" rule (E-1.5 5.5.2). Overview is
`{ zoom: 1, centre: 172,172 }`; Focus uses `layout.focus.zoom`.

### 2.2 Outputs (callbacks)

| Callback            | Payload                                                             | Fired when                                                                                                    |
| ------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `onSquarePress`     | `{ row, col, zoom }`                                                | Tap on a square (empty or pending). The app decides: place armed tile, arm-and-zoom, or recall a pending tile |
| `onSquareDoubleTap` | `{ row, col }`                                                      | Toggle Overview/Focus at that point                                                                           |
| `onDragStart`       | `{ source: 'rack' \| 'pending', index/row/col }`                    | 8 dp slop exceeded (E-1.5 5.5.2)                                                                              |
| `onDragMove`        | `{ target: {row,col} \| null, pointer }`                            | Target square changed (throttled to 20/s for haptics; pointer updates stay on the UI thread)                  |
| `onDrop`            | `{ target: {row,col} \| null, zone: 'board' \| 'rack' \| 'other' }` | Release. `null` target means the app returns the tile to its origin                                           |
| `onCameraGesture`   | `{ zoom, centre, phase: 'start'\|'update'\|'end' }`                 | Pinch, pan or double-tap; the app clamps and may suppress auto-camera                                         |
| `onEdgePan`         | `{ dx, dy }`                                                        | Held within 48 dp of a board edge in Focus: 240 dp/s                                                          |

The renderer never mutates state and never shows a tile the props do not contain. A drop that is illegal is the
app's call (return to origin with `motion.spring.tile`); the renderer only draws the props it is handed.

### 2.3 Hit-testing

- Pure function `hitTest(point, camera, boardOrigin): {row, col} | null` exported and unit-tested:
  `board = (point - origin - viewportCentre) / zoom + camera.centre`, `col = floor(x / cell)`, `row = floor(y / cell)`,
  `cell = 344 / 15`; null outside the 15 x 15 range. Rounding uses device pixels only for drawing, never for hit-testing.
- The drag tile is drawn **56 dp above the pointer** (E-1.5 5.5.2); the drop target is the square under the **tile
  centre** (not the finger), so the user sees the target they will get.
- Targets: at zoom >= 2.15 squares are >= 49 dp (meets `layout.touch.min`). At Overview squares are 22.9 dp: they are
  drag-drop targets and tap-to-arm regions only (documented exception, E-1.5 4.1). No hit slop is added between
  squares; adjacent squares tile the plane exactly.
- Gesture arbitration: tile drag (from rack or pending tile) > pinch > pan. Pan starts only on a committed tile or empty
  square with no held tile. Implemented with `react-native-gesture-handler` `Gesture.Race/Simultaneous` on the UI
  thread **[A-5]**.

### 2.4 Layers and drawing order

1. **Static layer** (cached `SkPicture`, rebuilt only when `squares` or `theme` changes): board bg, grid, premium tint,
   premium shape motif, premium label, committed tiles. Overview <-> Focus is a transform on this picture, never a re-layout.
2. **Dynamic layer**: pending tiles (elevation 2), highlights (last-move ring + notch, rejected dashed outlines,
   drop-target outline + chevron).
3. **Drag layer**: the dragged tile only (elevation 3, scale 1.15), its own layer so pointer moves redraw one tile.
4. **A11y layer** (only when `a11yMode = 'screenReader'`): native views overlaid, see 2.5. The Skia canvas is hidden
   from the accessibility tree (`importantForAccessibility="no-hide-descendants"`) in that mode.

Premium squares under a tile are not drawn (premium applies once). A tile glyph uses `type.tile.letter.*` by zoom:
Overview below zoom 1.6, Focus at 1.6 and above (switch on a threshold, no scaling of glyphs between).

### 2.5 Premium encoding: colour + shape + label (E-1.5 7.1)

| Square | Colour token | Shape motif (stroke 1.5 dp, `premium.label` colour) | Label EN / FR (from catalogue) |
| ------ | ------------ | --------------------------------------------------- | ------------------------------ |
| DL     | `premium.dl` | single ring (circle)                                | 2L / L2                        |
| TL     | `premium.tl` | double ring                                         | 3L / L3                        |
| DW     | `premium.dw` | single diamond                                      | 2W / M2                        |
| TW     | `premium.tw` | double diamond                                      | 3W / M3                        |
| START  | `premium.dw` | star over diamond                                   | star + 2W / M2                 |

Rules: the three cues are always drawn together (a unit test snapshots all five squares in both themes and in a
greyscale filter, and asserts the shape differs pairwise). The label is mandatory in Overview (9 sp) and Focus (12 sp);
there is **no** setting that hides it. Labels come from i18n keys (`board.premium.dl.label`, ...), passed in `labels`.
No premium cue is ever the sole differentiator for pending vs committed, last move or rejection (E-1.5 9.4):
pending = accent border + lift shadow + pencil corner mark; last move = white ring + notch; rejected = dashed outline + "!".

### 2.6 Accessibility

- **Screen-reader model (D-21):** 15 row groups ("Row 8") x 15 square nodes, row/column **1-based**, row-major. Square
  label via formatter `labels.square({ row, col, premium?, letter?, value?, owner?, isLastMove, isPending, isBlank })`
  returning e.g. "Triple word square, row 8 column 8, empty" or "Letter K, 5 points, row 4 column 7, played by you, last
  move"; blank reads "blank as O". Roles: `button` for empty and pending squares while a tile is armed or pending,
  otherwise `text`. State: `selected`/`disabled` where relevant. Hint `a11y.square.place_hint` only while a tile is armed.
- Board container custom actions: "Jump to last move", "Read board summary".
- Touch targets in a11y mode: each square's accessible frame is its **on-screen rectangle at the current zoom**; because
  Overview squares are < 48 dp, when `a11yMode = 'screenReader'` the app switches the camera to Focus on first focus
  of the board (a cut, no animation) so the focusable frames are >= 48 dp **[A-6]**. The 15 x 15 nodes outside the viewport stay
  in the tree (virtualised nodes would break swipe navigation) but are `accessibilityElementsHidden=false` and
  clipped to the viewport frame.
- Drag has a non-drag equivalent everywhere (select rack tile then activate a square). No gesture is required to use the board.
- Focus ring (2 dp `accent.primary`) on the focused square for switch/keyboard users.
- Live regions are owned by the app screen (status strip), not the renderer.

### 2.7 Performance budget (reference: low-end Android 10+, 2-3 GB RAM, 360 x 800 dp)

| Metric                           | Budget                                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Drag, pan, pinch                 | 60 fps target, **never below 30 fps** on the reference device; 0 JS-thread work per pointer-move frame (worklets only)            |
| Static layer rebuild             | <= 8 ms (only on committed-state change)                                                                                          |
| Dynamic + drag layer frame       | <= 4 ms GPU/UI per frame                                                                                                          |
| First board paint after PLAY NOW | <= 300 ms from navigation (board drawn from layout constants before the engine is ready)                                          |
| Memory                           | Board layers <= 20 MB; no per-frame allocations (preallocated `Skia.Paint`/`Path`, glyph atlas for 26 letters x 2 sizes + digits) |
| Bundle                           | Fonts: JetBrains Mono 500 + 700 Latin subset only; no raster assets in the board                                                  |
| Degrade below 3 GB RAM **[A-7]** | Shadows replaced by 1 dp border, particles off (D-27); layout and cues unchanged                                                  |

Verification (S1 definition of done): a Maestro or manual perf run on the reference device recording fps during a
scripted 10 s drag + pinch (Perfetto or Reanimated frame callback); results pasted into the slice PR. A render
snapshot test per state (empty, pending, rejected, last move, drop target) in both themes.

## 3. Motion and reduced motion

Principles: motion explains cause and effect (placement, score, bot move), is interruptible, never blocks input,
never loops in an attention-seeking way, and nothing flashes more than 3 Hz.

- **Rule 1 (twin rule):** every animation has an entry in a single registry `motion.registry` in
  `packages/design-system/src/motion/` of the form `{ id, full: {duration, easing|spring}, reduced: {kind} }`. A unit
  test fails if an `id` has no `reduced` twin. Components call `useMotion(id)` and never `withTiming` directly.
- **Rule 2:** `reduced.kind` is one of `instant`, `crossfade150`, `static` (a static visual state replaces movement,
  e.g. accent border for lift) or `outlineFlash`. No reduced twin may rely on movement.
- **Rule 3:** the mode is `full | reduced`, resolved once at the app root: Settings (Follow system / Reduce / Full,
  D-22) over `AccessibilityInfo.isReduceMotionEnabled`; changes apply live.
- **Rule 4:** information never auto-dismisses (D-6, D-14); only confirmations use `motion.duration.confirm`.
- **Rule 5:** only transform and opacity are animated on the board and strip (E-1.5 8.4); no layout animation.

S1 registry (full values and twins are E-1.5 8.1 and 8.2, reproduced here as the contract):

| id                                | Full                            | Reduced twin                       |
| --------------------------------- | ------------------------------- | ---------------------------------- |
| `tile.pickup`                     | scale 1.15 + lift, `fast`       | static accent border + lift shadow |
| `tile.settle`                     | `motion.spring.tile`            | instant                            |
| `tile.return` / `rack.recall`     | 200 ms `ease.standard`          | instant                            |
| `tile.reject`                     | shake 6 dp x 3, 240 ms          | outlineFlash 150 ms                |
| `rack.deal`                       | 40 ms stagger, `base`           | instant                            |
| `rack.shuffle`                    | permutation, `base`             | instant                            |
| `camera.move`                     | `camera` 240 ms `ease.standard` | cut (0 ms)                         |
| `score.pop`                       | rise 24 dp, `scorePop`          | static "+N" 1.2 s beside the word  |
| `score.count`                     | `scoreCount`                    | instant                            |
| `bot.dots`                        | three pulsing dots              | static "..."                       |
| `bot.drop`                        | 60 ms stagger                   | instant, ring shown                |
| `sheet.present` / `sheet.dismiss` | slide, `base` / `fast`          | crossfade150                       |
| `toast.present`                   | fade + 8 dp translate, `fast`   | crossfade150                       |
| `banner.fullstack`                | 1.2 s banner + <= 16 particles  | static banner 1.2 s, no particles  |
| `button.press`                    | scale .98, `fast`               | background colour change only      |

Haptics (E-1.5 8.1) are separate from motion and not disabled by reduced motion; they follow the Vibration setting
only. Wrapper `haptic(kind)`, kinds: `light`, `selection`, `success`, `strongSuccess`, `error`.

## 4. S1 component list

Only these are in scope for S1 plus `Board`/`Tile`/`Rack` (section 2). Each component: tokens only, states below, all
text via props (never literals), min touch 48 x 48 dp (`layout.touch.min`) with `hitSlop` where the visual is smaller,
focus ring 2 dp accent, role/state exposed to the a11y tree.

| Component          | Variants                                                                                                | States (all required)                                                                                                                                                                  | Notes                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`           | `primary` (PLAY, PLAY NOW: 56 dp, 72 dp "hero" size), `secondary`, `destructive`, `icon`, `text`        | default, pressed, focused, disabled (still focusable, `accessibilityHint` states why), loading (spinner, label kept, width stable)                                                     | Radius `button`; min width, multi-line, never fixed width (FR +30 %); icon + label stacked for rack actions (caption)                                                                                                       |
| `RackTile`         | `rack` (48 x 56), `pending`, `committed-small` (Summary rack)                                           | rest, selected (raised 8 dp, accent border), dragging (elevation 3, scale 1.15), pending (border + shadow + pencil mark), blank (dotted outline, `_`), empty slot (dashed placeholder) | Letter `type.tile.letter.rack`, value bottom-end (logical end); a11y "Rack, tile 3 of 7: Letter P, 2 points" + custom actions Move left/right                                                                               |
| `ScoreChip`        | `score` (name + mono score, turn marker), `bag` (icon + count), `delta` ("+N" breakdown chip with icon) | idle, active turn (underline + dot + text, not colour only), counting (value animating, a11y value set once at end)                                                                    | Mono tabular digits; announces on commit only, never per frame                                                                                                                                                              |
| `BottomSheet`      | `standard` (<= 85 % height), `blankPicker`, `menu`                                                      | closed, presenting, open, dragging (grabber), dismissing; with scrim                                                                                                                   | Grabber + always-visible Close 48 dp; swipe-down, scrim tap and system back all close; traps focus, restores it to the invoker; bottom-anchored (thumb zone); content scrolls, header fixed                                 |
| `Toast` (snackbar) | `info`, `error`, `confirm`                                                                              | entering, visible, exiting                                                                                                                                                             | Information/error toasts are persistent until dismissed or replaced (D-6); `confirm` auto-hides after `motion.duration.confirm`; optional single action; placed above the action row; polite live region (error: assertive) |

Also needed by S1 but trivial wrappers (token-only, no extra states beyond default/pressed/disabled): `Banner`
(status strip: idle, preview, rejection, breakdown; E-1.5 5.5), `Text` (variants = `type.*` tokens), `Icon`
(24 dp; set limited to those named in E-1.5: code, cpu-chip, network, cloud, infinity, database, sparkles, shield,
memory, menu, gear, shuffle, exchange, pass, recall, zoom, pause, warning, check, close, chevron, bag, pencil).

Preview badge (`Base N`) and zoom/recall board-corner buttons are `Button` (`icon`) and `Banner` compositions; no
dedicated component in v1.

## 5. i18n and RTL-readiness constraints

1. **No hard-coded user-facing strings** in `packages/design-system` or app components. Components accept `label`,
   `accessibilityLabel`, `accessibilityHint` and formatter functions as props; the renderer takes a `labels` object
   (2.1). Lint rule `no-literal-ui-strings` (or `react-native/no-raw-text` plus review) is enabled in A1. Keys follow
   E-1.5 section 10 (`home.*`, `match.*`, `a11y.*`, `board.premium.*`).
2. **Logical start/end only:** `marginStart/End`, `paddingStart/End`, `start/end` insets, `textAlign: 'auto'` or
   `'left'/'right'` forbidden by lint in the package. Icons that imply direction (chevron, back arrow) mirror in RTL
   via a `directional` flag; others do not.
3. **What does NOT mirror:** the board and the rack (A to Z, rows left to right; E-1.5 section 1), digits, the
   `type.mono.*` tiles/scores. The renderer therefore sets `direction: 'ltr'` on its own canvas and a11y layer; row/column
   order is a game constant. Everything else (top bar, action row, sheets, chips) mirrors; the handedness setting
   (D-10) inverts the default in RTL.
4. **Text expansion:** FR is about +30 %; components must survive a +30 % pseudo-locale and 200 % font scale (E-1.5 9.3)
   without truncating actions: buttons wrap, chips wrap, sheets scroll. Premium labels (2L/L2) are the one fixed-size
   text and are short by design.
5. **Formatting:** numbers via ICU/`Intl` (`{count, plural, ...}` for counts such as "squares", "tiles"); mono tabular
   digits use Latin numerals in all locales in v1 **[A-8]**. FR punctuation spacing (U+202F, U+00A0) lives in the
   catalogue (D-19), never in components.
6. **Locale-independent layout:** no width computed from a string length; mono tile/score slots are sized for 3 digits
   (scores can be negative: reserve the sign).
7. **Fonts:** JetBrains Mono Latin subset covers EN and FR (accents included); a locale needing other glyphs falls
   back to the system mono, and tile glyphs stay A-Z in v1 (Classic letters-v1).

## 6. Acceptance for A1 and S1 (what "done" means for this spec)

- [ ] `packages/design-system/tokens/*.json` exist with every token in section 1, both modes; typed build output
      consumed by `apps/mobile`; no literal colours/durations outside the package (lint).
- [ ] Contrast script passes (4.5:1 text, 3:1 UI) in dark and light for the roles in 1.2.
- [ ] `BoardView` implements the contract in section 2 (props, callbacks, `hitTest` unit tests incl. zoom 1.0, 2.15, 2.5
      and board edges); premium cue snapshot tests in 2 themes + greyscale.
- [ ] Perf evidence on the reference device per 2.7 attached to the S1 PR.
- [ ] Motion registry test: every id has a reduced twin (section 3).
- [ ] The five S1 components exist with the states in section 4, a token/component gallery screen behind a dev flag.
- [ ] Screen-reader walk-through of "place a tile and PLAY" on TalkBack without sight, recorded in the PR.
- [ ] Feature flag: none of this is user-visible by itself; S1's flag governs exposure (CLAUDE.md rule 10).

## 7. Analytics events

Design-system code emits **no** analytics. The app layer emits the events already defined by E-1.5 section 11 /
`docs/standards/ANALYTICS_EVENTS.md`; renderer callbacks (section 2.2) carry the data the app needs (for example
placement path = tap or drag, and whether a camera move was automatic).

## 8. Out of scope for v1 (deferred, by slice)

Web token build and components; Segmented, Coach marks, ResultHeader, BreakdownList, BotAvatar, Dialog, ListRow,
Toggle, Skeleton, CategoryBadge (needed by S2/Summary and Settings); theme picker; high-contrast theme; tablet and
landscape; sound engine (E-1.5 8.3); tech-square rendering; spectator/replay board mode (E-1.5 D-27 family).

## 9. Assumptions

| #   | Assumption                                                                                                           | Reversal / check                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| A-1 | DTCG JSON with a typed TS build is acceptable to `mobile-engineer`; Style Dictionary may be used but is not mandated | Swap the builder, keep token names                                                                                          |
| A-2 | Light-theme values (and darkened category hues) are first proposals, not designed with a full colour review          | Contrast script decides; adjust values, names stay                                                                          |
| A-3 | Elevation 1 in light uses a 1 dp soft shadow                                                                         | Cosmetic                                                                                                                    |
| A-4 | The renderer lives in `packages/design-system` (shared by a future web canvas), not in `apps/mobile`                 | If Skia coupling makes the package heavy, move to `apps/mobile/src/board` and keep the contract                             |
| A-5 | `react-native-gesture-handler` + Reanimated worklets are available in the Expo scaffold (ADR-0002 stack)             | Confirm in A1                                                                                                               |
| A-6 | Auto-switching to Focus when a screen reader focuses the board is acceptable                                         | If TalkBack exploration by touch misbehaves, keep Overview and enlarge the a11y frames with an expanded accessible hit area |
| A-7 | RAM is readable at runtime on both platforms (Android via device info; iOS treated as sufficient)                    | Use a coarse device-class heuristic                                                                                         |
| A-8 | Latin digits in tiles and scores for all launch locales (EN, FR)                                                     | Revisit before an Arabic locale                                                                                             |
| A-9 | Perf budget numbers (8 ms, 4 ms, 20 MB) are starting targets, not measured                                           | Replace with measured values after the first reference-device run                                                           |
