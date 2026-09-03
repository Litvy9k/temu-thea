# temu-thea

A hex-grid survival game on a big procedural map. React 19 + Vite, fully
static — no backend, no network requests. Core logic in TypeScript, React
components in JSX.

Gameplay and directory layout are in `README.md`. This file records **why each
decision was made**, and **what goes wrong if you undo it**.

Source comments are in Chinese; these docs are in English.

## Architecture

```
src/game/            portable boundary: drops into any React project as-is
  core/              pure logic, no DOM, runs directly under node
    hex.ts           hex math
    map.ts           map storage (odd-r flat array) and noise generation
    terrain.ts       terrain table
    works.ts         facility and tool tables
    state.ts         state and rules
    save.ts          save serialisation
  render/            camera.ts camera and culling, draw.ts canvas drawing
  ui/
    useHexGame.js    interaction logic — one "brain" shared by both layouts
    Game.jsx         four jobs only: mount canvas, measure width, pick layout,
                     place the camp panel
    DesktopLayout    floating panels  /  MobileLayout  top strip + thumb dock
    CampPanel        facilities + crafting, an on-demand drawer
    parts.jsx        display pieces shared by both layouts
    SaveControls     new game / save / load
src/App.jsx          dev shell, thrown away on integration
scripts/             dump-map.ts prints an ASCII map, sim.ts runs the economy ledger
```

## Settled rules

**Axial `{q, r}` is the only logical coordinate.** Cube coordinates appear only
inside distance and rounding, offset coordinates only when indexing the flat
array, pixel coordinates only in rendering and pointer handling. Convert back
at every boundary — all four are "two numbers", the type system cannot help,
and mixing them does not throw. It just draws wrong.

**Roaming and camped are mutually exclusive states.** `camp === null` can move
but cannot work; `camp !== null` is the reverse. **What a click means is decided
in exactly one place, `onPointerUp`.** Do not re-derive it elsewhere.

**Gathering speed has one source of truth: `workRateAt()`.** The tile panel, the
progress bar and `endTurn` all read it. Two implementations are invisible on
screen and surface only as "the panel says 60 but the bar moved 40". There is a
test in `works.test.ts` pinning them together.

**Facilities and tools hang off the party (`state.works`), not the camp
(`state.camp`).** Breaking camp nulls `camp` while `works` travels with the
party, so "they survive re-camping" falls out of the data model and needs **no
carry-over logic** — a "stash the facilities before breaking camp" step is
exactly where a field gets forgotten later. This is a deliberate trade of
realism for playability; read it as gear the expedition packs up and takes.

**One set of interaction logic, two layouts.** Desktop and mobile present
information differently, but drag threshold, pinch zoom and click semantics are
the same rules and all live in `useHexGame.js`. Copied into two layouts, one
eventually falls behind.

**Layout switches on container width; tap-target size switches on
`pointer: coarse`.** Two different things. Container not viewport, because the
game gets embedded in a column on a personal site — a narrow column deserves the
narrow layout even in a desktop browser, and `matchMedia` on the viewport would
answer wrong there. Meanwhile an iPad in landscape is wide enough for the wide
layout, but fingers are still fingers, so buttons stay 44px.

**The terrain table is the single source of gameplay truth.** Where you can
walk, where you can camp and what you can gather all read `terrain.ts`. One hard
rule: **no terrain is rich in both food and wood** — a camp with only grassland
runs out of fuel, one with only forest starves, so a site must have both. That
is the entire weight of the "where to camp" decision. Keep this rule when adding
resource types: no single site yielding everything is what gives a reason to
move.

**`yields` is "output per completed bar", not per turn.** Each person advances
20 per turn against a goal of 40, so over time **one person completes 0.5
harvests per turn** and single-person output is `yields / 2`. Estimate from the
literal numbers and you will be off by a factor of two.

**Map composition is designed, not emergent.** Terrain thresholds are cut by
**quantile** (`COMPOSITION`), not by fixed elevation values. fBm averages
several octaves, so its output clusters around 0.5 and absolute thresholds barely
reach the tails — measured, that gave 0% mountains and 1.6% hills, and the mix
changed completely with every seed, up to rolling a map that is almost all
ocean. With quantiles, land fraction is stable on every map.

**Saves do not rebuild terrain from the seed.** Terrain is stored as-is (about
6KB compressed). Rebuilding from a seed would fit in a few hundred bytes, but
then any tweak to the terrain table or the noise parameters would **silently
change the map** in every old save — no error, just a different world. Saves
carry a `v` field; a mismatch is rejected outright rather than force-parsed.
`TERRAIN_CODES` in `save.ts` is **append-only: never reorder, never delete**.

**Both languages are hardcoded at the point of use; the game never owns the
switch.** `i18n.js`, `terrain.ts`, `works.ts` and the `SaveError` throws all
carry `{ en, zh }` pairs inline — no translation files, no i18n library. `Game`
and `SaveControls` each take a `lang` prop and the host decides its value. The
dev shell has a toggle purely to stand in for the site's global switch; it is
not part of the game and goes away with `App.jsx`.

**`game/` must not depend on the host site.** Do not import the site's i18n
instance, do not use its CSS variables, do not touch `body` / `:root` globals.

## Things that bit us (each took a while to find)

**Canvas needs `touch-action: none`.** Without it a finger drag gets taken by the
browser to scroll the page, `pointermove` never arrives continuously, and panning
and pinch zoom both stop working — while **a mouse on desktop behaves
perfectly**, so desktop-only testing never catches it.

**`Math.round(-0.4)` returns `-0`.** With `-0` in a coordinate,
`deepStrictEqual` and `Object.is` report inequality while `===` reports equality,
and `{ q: -12, r: -0 }` in a debugger is baffling. Normalised inside `round()` in
`hex.ts` — do not let it escape that function.

**`ring()` depends on `DIRECTIONS` being counter-clockwise.** The ring algorithm
requires that walking `n` steps along direction `i` traverses exactly edge `i`;
flip the array to clockwise and it must be iterated in reverse. Read the test
before touching that array. The symptom is only "the range outline looks a bit
odd" — nothing throws.

**TypeScript in Vite is decorative by default.** Vite strips types without
checking them. `draw.ts` once imported a function from `map.ts` that actually
lives in `hex.ts`, and it reached the browser as a white screen. **Always run
`npm run typecheck`**, and carry that step along when integrating elsewhere.

**Vite's module transform cache can stick on an intermediate state.** After two
writes to the same file in quick succession the watcher may only register the
first — source is new, the transform the dev server hands out is old. **When a
change does not show up, first confirm the browser actually got the new code**
(`fetch('/src/…/x.jsx')` and read the transform). A hard reload is not always
enough; the cache is server-side, so restart the dev server.

**`setPointerCapture` can throw `NotFoundError`.** It throws when the pointer is
released before the handler runs, and an uncaught throw kills the whole
`pointerdown` — the symptom is "occasionally a click does nothing at all".
Wrapped in try/catch.

**A file input must have its `value` cleared every time.** Otherwise picking the
same file twice fires no `change` event — "load only works once", with no error.

**CSS specificity: `.hexgame .hg-actions button` beats
`.hexgame .hg-actions__camp`.** Two classes plus an element selector beats two
classes. Do the arithmetic before adding a per-button exception, or you leave
behind a rule that **looks applied but is not**, plus a comment stating the
opposite of reality.

**Layout decisions must not read a width that the layout itself changes.**
Narrow/wide used to be decided from the map area (`.hg-stage`), while the camp
panel takes a flex column in the wide layout and goes absolutely positioned in
the narrow one — so: squeezed → judged narrow → panel leaves the flow → wide
again → judged wide, **flipping every single frame**, with the screen strobing.
Narrow/wide now reads only the outer `.hexgame`, whose width the panel cannot
affect.

This one only appears in the **720–988px** band (squeezed width below the
threshold while the container itself is above it), which is exactly where a phone
in landscape lands. It was missed because the panel had been tested at 1000px,
where squeezing leaves 732 — twelve pixels clear. **After changing anything
layout-related, test one width on each side of the threshold, not just one.**

**The shared `--panel` colour is translucent.** That is for small panels floating
over a map corner. A panel that covers the whole area (the camp panel in the
narrow layout, or in overlay mode) must be opaque, or the map and status strip
show straight through and text lands on text.

## This machine

- Node 22.17; `node:test` needs `--experimental-strip-types` for `.ts`
  (already in the npm scripts)
- **No `gh` CLI installed** — GitHub repos have to be created through the web UI
- **`git push` must use the Windows ssh**; the one bundled with Git Bash cannot
  see the keys in the Windows ssh-agent:
  `GIT_SSH_COMMAND="/c/Windows/System32/OpenSSH/ssh.exe" git push`
  (or once: `git config --global core.sshCommand "C:/Windows/System32/OpenSSH/ssh.exe"`)
- Vite does not read the `PORT` environment variable by default; `vite.config.js`
  wires it up. Without that it silently walks to the next free port and external
  tooling cannot reach it.

## When integrating into dope-website

The game goes in `frontend/src/game/`, with its route added **before** the `*`
catch-all in `App.jsx`. Drop the `src/App.jsx` dev shell — the site only needs to
mount `<Game />` and `<SaveControls />`, and to pass its own `lang` down.

Several notes from that repo's own `CLAUDE.md` apply directly:

- **The font subset is generated at build time by scanning `content/` and
  `src/`.** Chinese written literally in the source is fine, but **text assembled
  or generated at runtime** (random place names, numbers glued to units) is not
  scanned, so it renders with missing glyphs in production — and never locally,
  where the full font is installed. All game copy is literal today; watch this
  when adding generated text.
- z-index: the site's bottom bar is 1000 and tooltips are 1200; game overlays
  have to fit that scheme
- Do not use `100vw` (it includes the scrollbar); measure canvas size with
  `clientWidth`
- The site is plain JS with oxlint, which is why **core logic is `.ts` and React
  components are `.jsx`** — its lint only ever sees `.jsx` and needs no
  typescript-eslint
- The preview environment does not composite frames, so time-based animation
  cannot be verified there; only end states can
