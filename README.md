# temu-thea

A hex-grid survival game on a big procedural map. Roam, make camp, assign
people to gather from the surrounding tiles, then spend what you gather on
facilities and tools. Pure front end — no backend, no network requests.

React 19 + Vite. Core logic in TypeScript, React components in JSX.

Bilingual (English / 中文). The game takes a `lang` prop; the host decides
its value — there is no language switch inside the game itself.

## Running it

```
npm install
npm run dev        # dev server
npm run build      # emits dist/ — three static files
npm test           # 34 tests, no test framework (node:test)
npm run typecheck  # tsc --noEmit
```

Two terminal tools for tuning numbers:

```
npm run map -- thermopylae   # print a map as ASCII, for tuning terrain thresholds
npm run sim -- thea 30    # run a greedy AI for 30 turns, print the resource ledger
```

## How it plays

**Roaming** and **camped** are mutually exclusive. While roaming you can move
but nobody works, so the party is pure upkeep. While camped you cannot move,
but you can send people to the six tiles around the camp. Making and breaking
camp each consume the rest of the turn's movement, so relocating costs at
least one full turn.

Every tile has a 0/40 gathering bar. Each assigned person advances it 20 per
turn, up to 5 people per tile, and progress overflows — three people push 60,
which is one harvest plus 20 left on the bar.

Food is consumed per person; wood is a flat 1 per turn (the campfire burns the
same whether three people sit around it or ten). Running out of either costs
one person per turn. No terrain is rich in both food and wood, so a camp site
has to have both nearby — that is the whole weight of the "where to camp"
decision.

Tools are counted, one per person, and **handed out in deployment order**:
with three axes, the first three people sent into the woods get the bonus, and
their crew dots on the map are green.

## Layout

```
src/game/            portable boundary — this directory drops into any React project
  core/              pure logic, no DOM, runs directly under node
    hex.ts           hex math: axial coords, pixel conversion, ranges, cost-aware reach
    map.ts           map storage and noise generation
    terrain.ts       terrain table — nearly all gameplay difference lives here
    works.ts         facility and tool tables
    state.ts         state and rules (move / camp / assign / turn resolution)
    save.ts          save serialisation
    rng.ts           reproducible seeded random
  render/            canvas drawing and camera
  ui/                React components
    useHexGame.js    interaction logic — one "brain" shared by both layouts
    DesktopLayout    floating panels
    MobileLayout     top strip + thumb dock
src/App.jsx          dev shell, thrown away on integration
scripts/             the two terminal tools above
```

## What the host can restyle

`src/game/ui/Game.css` puts its palette on `.hexgame` — `--ink`, `--ink-dim`,
`--line`, `--panel`, `--accent`, `--warn`, `--idle`.

Border thickness is the one knob deliberately *not* declared there. It is
written as `var(--line-w, 1px)` at each of the six places that draw a line, so
a host can set `--line-w` on any ancestor and every rule follows. Declaring it
on `.hexgame` would defeat that: custom properties resolve by inheritance and
the nearest declaration wins, so the game's own value would override whatever
the host set further out.

`SaveControls` is styled by the host too — its stylesheet sets layout only, no
colours or borders.

## Rules that are settled

**Layout switches on container width; tap-target size switches on
`pointer: coarse`.** Two different things. The game is meant to be embedded in
a column on a personal site, so a narrow column deserves the narrow layout even
in a desktop browser — hence container width, not viewport. Meanwhile an iPad
in landscape is wide enough for the wide layout, but fingers are still fingers,
so buttons stay 44px.

**There is one set of interaction logic.** Desktop and mobile present
information differently, but drag thresholds, pinch zoom and click semantics
are the same rules, all in `useHexGame.js`. Copy them into two layouts and one
of them eventually falls behind.

**Gathering speed has a single source of truth.** `workRateAt()` — the tile
panel, the progress bar and turn resolution all read it. Two implementations
would be invisible on screen and show up only as "the panel says 60 but the bar
moved 40".

**Facilities and tools belong to the party, not to the camp.** So "they survive
breaking camp" falls out of the data model instead of needing carry-over
logic — that kind of logic is exactly where a field gets forgotten later. Read
them as gear the expedition packs up and takes along.

**Saves do not rebuild terrain from the seed.** Terrain is stored as-is
(about 6KB compressed), decoupled from the generator. Rebuilding from a seed
would fit in a few hundred bytes, but then every tweak to the terrain table or
noise parameters would silently change the map in every old save — no error,
just a different world.

**Map composition is designed, not emergent.** Terrain thresholds are cut by
quantile, so land fraction and mountain fraction are stable across seeds. You
never roll a map that is 90% ocean.

## Things that bit us

**Canvas needs `touch-action: none`.** Without it a finger drag is taken by the
browser to scroll the page, `pointermove` never arrives continuously, and both
panning and pinch zoom silently stop working — while a mouse on desktop behaves
perfectly, so desktop-only testing never catches it.

**`Math.round(-0.4)` returns `-0`.** Once `-0` is in a coordinate,
`deepStrictEqual` and `Object.is` report inequality while `===` reports
equality. Normalised inside `round()` in `hex.ts`.

**A file input must have its `value` cleared every time.** Otherwise picking
the same file twice fires no `change` event — "load only works once", with no
error at all.

**Vite's module transform cache can stick on a stale version.** After two
writes to one file in quick succession, the source can be new while the dev
server still serves the old transform. When a change does not show up, first
check what the browser actually received (fetch the module path and read the
transform); a hard reload is not always enough, because the cache lives on the
server — restarting the dev server is.

## Not done yet

- More resource types (the goal is that no single site yields everything,
  which forces you to move)
- Random events
- Combat (none today, and not necessarily ever)
