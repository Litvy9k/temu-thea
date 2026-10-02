# temu-thea — development notes

The technical reference and the to-do list. Player-facing rules are in
[MANUAL.md](MANUAL.md). The reasoning behind each rule — and what breaks if it
is undone — is in [CLAUDE.md](../CLAUDE.md); this file describes *how* things
work and *what is left to do*, and links there rather than repeating it.

- [Running](#running)
- [Architecture](#architecture)
- [Game state](#game-state)
- [Turn resolution](#turn-resolution)
- [Map generation](#map-generation)
- [Deposits and surveying](#deposits-and-surveying)
- [Crew and the per-tile cap](#crew-and-the-per-tile-cap)
- [Seasons](#seasons)
- [Camp sites, buildings and gear](#camp-sites-buildings-and-gear)
- [Rendering](#rendering)
- [UI overlays](#ui-overlays)
- [Save format](#save-format)
- [Events](#events)
- [Tests](#tests)
- [Analysis scripts](#analysis-scripts)
- [Balance model](#balance-model)
- [To do](#to-do)

## Running

```
npm install
npm run dev          # dev server on :5173
npm run build        # static dist/ (JS + CSS, no backend)
npm test             # 123 tests, node:test, no framework
npm run typecheck    # tsc --noEmit — Vite only strips types, it never checks them
npm run lint         # oxlint
```

Node 22.17; `.ts` runs under node via `--experimental-strip-types`, which the npm
scripts already pass.

## Architecture

```
src/game/core/     pure rules — no DOM, no React, runs under node
  hex.ts           axial coordinates, distance, ring/range, Dijkstra reach
  map.ts           odd-r flat tile array, noise, terrain, spawn point, deposits
  terrain.ts       terrain table, resource table, primary-yield lookup
  deposits.ts      deposit table, distance gradient, yieldsOf()
  seasons.ts       calendar, season effects and their constants
  works.ts         building, gear and tool tables, costs
  events.ts        event table and the condition evaluator
  state.ts         GameState, every action, endTurn()
  save.ts          JSON (de)serialisation with a compressed map
  rng.ts           mulberry32 with a pure step() so the RNG lives in state
src/game/render/   camera.ts (pan, zoom, culling) and draw.ts (canvas)
src/game/ui/       React — one hook (useHexGame) drives two layouts;
                   Overlays.jsx has the confirmation dialog and notices
src/game/i18n.js   UI strings as { en, zh } pairs
scripts/           terminal tools, see below
```

`src/game/` is the portable boundary that gets copied into the host site; the
integration contract is in CLAUDE.md. Core is `.ts`, components are `.jsx`,
because the host lints plain JS only.

Data flows one way: UI calls an action in `state.ts` → the action mutates
`GameState` in place and bumps `state.version` → React re-renders off the version
→ `drawScene()` reads the state and paints. Nothing in `core/` knows React exists.

## Game state

`GameState` is plain data and is what gets saved (minus the derived bits).

| Field | Meaning |
| --- | --- |
| `map` | `{ width, height, seed, origin, sites[], tiles[] }` |
| `party` | `{ at, moves, people, stranded }` |
| `camp` | `null` while roaming; `{ at, crew, order }` when camped |
| `works` | `{ gear[], tools{} }` — on the party, so it survives breaking camp |
| `turn` | 1-based |
| `stock` | current amount of each of the six resources |
| `lastIncome` / `lastShortage` / `lastWasted` | last turn's ledger, for the HUD |
| `lastStranded` | what the thaw took last turn, for a notice; not saved |
| `hardship` | consecutive shortage turns |
| `over` | everyone is dead |
| `pendingEvents` | event ids waiting for a choice; `endTurn` refuses while non-empty |
| `seenEvents` | `once` events that already fired |
| `seenResources` | resources shown in the HUD; append-only |
| `rngState` | event RNG state, so events replay identically from a save |
| `version` | render counter, not saved |

A tile is `{ terrain, explored, visible, progress, deposit, surveyed }`.
`visible` is recomputed every time and never saved. `explored` and `surveyed`
only ever go from false to true.

`camp.crew` maps a tile key to a head count; `camp.order` lists one tile key per
deployed person in deployment order. Tools are handed out by walking `order`, so
the order is state, not presentation.

A site is `{ at, buildings[], lastVisit }`. The camp has no pointer to its site:
`currentSite()` finds the site whose `at` equals `camp.at`.

**The season is not state.** `seasonAt(turn)` derives it from the turn number,
so there is nothing to keep in sync and nothing to validate on load.

## Turn resolution

`endTurn()` in `state.ts`, in order:

1. Refuse if `pendingEvents` is non-empty.
2. Tool allocation is computed once for the whole turn.
3. For every crewed tile: `progress += workRateAt().total`; each full 40 pays out
   `yieldsOf(terrain, deposit)`; the remainder stays on the bar.
4. Upkeep: `foodUpkeep()` (people − 1 if this camp has a store) and
   `woodUpkeep()` (1, or 3 in winter).
5. Income is added to stock, then `clampToCap()` throws away the excess and
   records it in `lastWasted`.
6. Stranded on thawed water: lose 0–2 people and 10–30% of each resource,
   recorded in `lastStranded`. Only positive stock is taken — a negative stock at
   this point is a shortage, and taking a share of it would erase the shortage.
7. Shortage: negative food or wood is recorded, clamped to 0, and costs one
   person; `trimCrew()` then withdraws the latest-deployed workers.
8. Otherwise, in spring, every 5th day of the season: +1 person.
9. The current site's `lastVisit` is refreshed; sites unvisited for
   `SITE_LIFETIME` turns are removed.
10. Moves reset to `partyMoves()`, the turn advances, `party.stranded` is set for
    the new turn, `refreshVision()` runs (summer sight, ice), and `noteResources()`
    updates the HUD list.
11. `rollEvent()` rolls every qualifying event against the snapshot.

`workRateAt()` is the only place gathering speed is computed — the panel, the
bar and step 3 all call it. A test pins them together.

## Map generation

`generateMap()` in `map.ts`:

1. Three value-noise fields (elevation, moisture, temperature), fBm, sampled in
   pixel space so odd-row offsets do not skew them.
2. Radial falloff pushes the rim into the sea.
3. Thresholds are cut by **quantile** (`COMPOSITION`): 42% water, then 8%
   mountains and 16% hills of the land, 34% forest and 16% desert of the flats.
4. Ocean next to land becomes shallows (geometric, not by elevation).
5. `findStart()` walks outward from the centre for the first passable tile whose
   ring has ≥ 8 food and ≥ 5 wood → `map.origin`.
6. `placeDeposits()` rolls deposits around `origin`.

Default map is 64 × 44 = 2816 tiles.

## Deposits and surveying

`deposits.ts` holds three deposits. Each one has a resource, a yield per
harvest, the terrains it may sit on, and a distance gradient:

| Deposit | Resource, per harvest | Terrains | near → far | Full density |
| --- | --- | --- | --- | --- |
| clay | clay 2 | marsh, shallow, grass | 1 → 20 | 9% |
| game | hide 2 | forest, tundra, grass | 6 → 24 | 9% |
| iron | iron 3 | hills, mountain | 11 → 26 | 22% |

`densityAt()` is 0 up to `near`, then rises linearly to the full density at
`far`. Placement walks every tile and rolls each deposit in `DEPOSIT_ORDER`
(rarest first), the first hit wins, and every deposit rolls on every tile even
after a hit, so the random stream does not shift when a parameter changes. Its
RNG is seeded separately from terrain.

**A deposit's yield must not exceed the lowest primary yield among its terrains**
(clay ≤ marsh's 2, hide ≤ tundra's 2, iron ≤ hills' 4), or tools silently stop
applying on that tile. `deposits.test.ts` checks this at the table level.

`yieldsOf(terrain, deposit)` is the single source of a tile's output.

**Surveying.** A tile is `surveyed` once the party has been within
`workRadius()` of it — roaming or camped. `refreshVision()` does it after the
sight pass. `workRadius()` is used both for this and for which tiles can be
worked, so every workable tile is already surveyed; no extra check exists, and a
test asserts the invariant. `noteResource()` runs on survey, not on sight —
otherwise the HUD would give away what the `?` is. `describeHex()` hides
unsurveyed deposits from the tile panel, yields included.

## Crew and the per-tile cap

| Constant / function | Value | |
| --- | --- | --- |
| `MAX_CREW_PER_TILE` | 6 | absolute ceiling — one indicator per hex edge |
| `BASE_CREW_CAP` | 2 | starting cap |
| `crewCap(state)` | `min(6, 2 + 2 × crew buildings)` | read from the current site |
| `workRadius(state)` | `1 + (outer grounds ? 1 : 0)` | work **and** survey radius |

`assignBlocker()` returns `'tileFull'` at `crewCap()`. `enforceCrewCap()`
withdraws workers latest-deployed first when they are over the cap **or outside
the radius**. It runs on load (saves from before the cap dropped from 5 to 2) and
after a demolition (losing crew expansion or outer grounds).

The choice of 2 comes from the balance measurements below.

## Seasons

`seasons.ts`. A season is 20 turns, a year 80, and turn 1 is the first day of
autumn (`START_OFFSET = 40`). `seasonAt(turn)` returns `{ id, index, day, year }`.

| Season | Effect | Where it is applied |
| --- | --- | --- |
| spring | marsh move cost 5; +1 person every 5th day (no shortage) | `stepCost()`, `endTurn()` |
| summer | sight +1 | `sightFrom()`, `campSight()` |
| autumn | — (seasonal events to come) | |
| winter | wood upkeep ×3; shallows cost 2 to enter; ice cannot be camped on | `woodUpkeep()`, `stepCost()`, `campBlocker()` |

`stepCost()` is the single place movement cost is decided, seasons included; the
tile panel, pathfinding and the reach shading all read it.

Events can test the season through the `season` metric (0–3); write conditions
with `inSeason('winter')`, never the bare number.

`effectsOf(id)` is the list of a season's rules shown to the player — in the
season tooltip and in the season-change notice. Seasons with no rules get a
fallback line, so neither is ever empty.

**Ice cannot be camped on** for free: shallows are impassable in the terrain
table, and `campBlocker()` already rejects impassable tiles.

### Stranded on thawed water

A party standing on a shallow outside winter is in the water.

- `party.stranded` is set at the start of each turn. While it is true,
  `stepCost()` lets the party enter other shallows for 2 moves. Ocean and
  mountains stay closed — otherwise a stranded party could walk across the sea.
  Which way to go is the player's call; nothing in the code judges "towards land".
- At the end of every turn still on water: `strandedPenalty()` takes 0–2 people
  and 10–30% (rounded up) of every positive stock, rolled on `state.rngState` so a
  save replays the same loss. It is a rule, not an event — event effects are fixed
  numbers, and there is no choice to make.

## Camp sites, buildings and gear

Works are split by **where they live**:

| | Lives on | Survives breaking camp | Table |
| --- | --- | --- | --- |
| Gear — tools (counted) and party gear (one each) | `state.works` | travels | `TOOLS`, `GEAR` |
| Buildings | `map.sites[i].buildings` | stays at the site | `BUILDINGS` |

Neither needs any carry-over logic, and that is the point: gear is already on the
party, buildings are already on the site, and the camp finds its site by
position. **Never copy buildings between the camp and a site.**

**Sites.** `buildBuilding()` creates a site at the camp on the first building;
a camp that never built anything leaves no site. `demolish()` removes a site once
its last building goes. A visit means camping there: `makeCamp()` and every
camped `endTurn()` set `lastVisit`. A site is removed when
`turn − lastVisit ≥ SITE_LIFETIME` (160 turns), with no warning.

**Limits.**

| | Value | Rule |
| --- | --- | --- |
| `MAX_SITES` | 5 | blocks the first building at a new place, never making camp |
| `BASE_SLOTS` / `EXPANDED_SLOTS` | 3 / 6 | `expansion` opens the extra slots |
| `Building.slot` | per building | expansion, crew1, crew2 take no slot |
| `Building.requires` | per building | must stand at the same site |
| `DEMOLISH_REFUND` | 0.5 | rounded down, then through `clampToCap()` |

`buildBlocker()` returns `noCamp`, `built`, `requires`, `slots`, `siteLimit` or
`cost`. `demolishBlocker()` returns `needed` when another building requires this
one, or when it is the expansion and more than 3 slots are in use.

**Buildings only work at their site.** `hasBuilding()` looks at the current
site, so a store's +40 and −1 food, a watchtower's sight and a workshop's
crafting all switch off when you camp elsewhere. `breakCampLoss()` says what a
lower cap would throw away when you leave; the UI confirms before `breakCamp()`,
which clamps and records the loss in `lastWasted`.

**Crafting** — tools and party gear alike — needs a workshop at the current site.

## UI overlays

| | Blocks input | Lives in | Used for |
| --- | --- | --- | --- |
| Event dialog | yes | `EventDialog.jsx` | events: the player must choose |
| Confirmation | yes | `Overlays.jsx` | breaking camp that throws goods away, demolishing |
| Notice | **no** | `Overlays.jsx` | a season change, a loss to the thaw |

Notices have `pointer-events: none` and fade after 4.5 s (`NOTICE_MS` in the hook,
matched by the CSS animation). On desktop they sit centred above the map; on
mobile they are **children of the status strip**, positioned from its bottom
edge — the strip's height changes with the number of resource rows, and a fixed
`top` once put them on top of it. While a confirmation is open, keyboard
shortcuts are ignored.

The season badge is a `<button>` styled as text. Its tooltip shows on `:hover`
inside `@media (hover: hover)` and on tap via an `is-open` class. Its selectors
are written as `.hexgame button.hg-season…` to outrank the global
`.hexgame button:hover:not(:disabled)` (0,3,1).

## Rendering

`drawScene()` in `draw.ts`, back to front:

1. Terrain fills, batched into one `Path2D` per terrain (and a second set,
   overlaid with `COLORS.memory`, for explored-but-not-visible tiles). In winter
   shallows go into an extra `ice` batch.
2. Grid lines (`s ≥ 11`).
3. Site frames (`s ≥ 9`).
4. Terrain glyphs, then deposit marks, then deposit dots.
5. Reach shading while roaming.
6. Camp: crew bars, progress bars, the camp ring and `⌂`; or the party dot.
7. Hover and selection outlines.

`s` is the on-screen hex size (centre to vertex) in pixels. Layout inside a hex
is the `SLOT` table, in units of `s`:

| Slot | y | Size | Drawn when |
| --- | --- | --- | --- |
| terrain glyph | −0.16 | font 0.62 | `s ≥ 13`, every tile |
| deposit glyph or `?` | +0.24 | font 0.36 | `s ≥ 20` |
| deposit dot | +0.24 | radius 0.1 | `9 ≤ s < 20` |
| progress bar | +0.44 | 0.62 × 0.07 | `s ≥ 12`, worked tiles |
| crew bars | inset 0.8 | middle 70% of each edge | `s ≥ 12`, work tiles with crew |
| site frame | inset 0.78 | grey hexagon outline | `s ≥ 9`, not on the current camp or a tile with crew bars |

Work tiles with nobody on them get a faint outline instead of bars, and so do all
work tiles below `s = 12`.

**Crew bars.** `corners()` lists vertices clockwise from the top, so edge `i`
runs from vertex `i` to `i + 1` and edge 0 is the upper-right one. Bar `i` is, in
order: geared person (`i < equipped`), bare person (`i < crew`), open slot
(`i < crewCap`), locked (dashed). All staffed tiles' bars are batched into four
`Path2D`s, so the bars cost four strokes a frame. Bars mark *where people are*,
not where they could be: drawing the full set on empty tiles filled the whole
ring with bars the moment you camped, and the tiles actually being worked
stopped standing out.

**Ice.** Winter shallows draw as `ICE` (fill `#35505c`, glyph `=`), and in the
last 3 turns of winter as cracking ice (`≠`). Ice has to look different from
water at a glance — it is the player's only cue that a route is open.

**Site frames** are skipped on tiles showing crew bars because the bars cover
only the middle of each edge; a frame underneath would show through the corner
gaps.

Glyphs come from the system monospace stack; `scripts/` has no glyph check, so
test a new symbol in the browser (compare `measureText` against `'￿'`).

## Save format

`serialize()` writes JSON with `v: 1`. The map is compressed to strings:

| Field | Encoding |
| --- | --- |
| `terrain` | one char per tile, `'A' + TERRAIN_CODES.indexOf(id)` |
| `explored` | one `0`/`1` per tile |
| `deposit` | one char per tile: `.` none, `'A' + DEPOSIT_CODES.indexOf(id)`, **lower case = not surveyed** |
| `progress` | sparse `{ index: value }` |
| `origin` | the spawn point |
| `sites` | `[{ at, buildings, lastVisit }]`, unknown buildings and empty sites dropped on load |

About 6KB in total. `TERRAIN_CODES` and `DEPOSIT_CODES` are append-only.

**Compatibility rule:** a new field with a safe default does not bump `v`.
`parseSave()` fills defaults: missing stock or tool entries are 0
(`fillStock`, `fillTools`), a missing deposit column means no deposits, a
missing origin falls back to the party position, an all-upper-case deposit column
(saved before surveying existed) reads as all surveyed, and over-cap crews are
trimmed. Saves from before the gear/building split have `works.facilities`:
`readWorks()` moves store, workshop and watchtower into a site at the party's
position (so a save made while camped keeps working), and jars and pack frames
into `works.gear`. Bump `v` only when old data would be *misread*.

Every load error is a `SaveError` carrying `{ en, zh }`.

## Events

`events.ts` is a table of `{ id, text, trigger: Rule[], choices[], once? }`.

- A rule is a list of conditions on metrics (`turn`, `people`, `idle`, `camped`,
  `season`, and the six resources), AND-ed; rules are OR-ed and the **highest** matching
  chance applies.
- Triggers are judged once on a snapshot at the turn boundary; a choice's
  `require` is judged live.
- Effects are data: `stock`, `stockPct`, `people`, `peoplePct`, `tools`. Percent
  terms come from the stock before the effect, and remove at least 1.
- Every event needs a choice with no `require`, or the game would freeze.

## Tests

| File | Tests | Covers |
| --- | --- | --- |
| `hex.test.ts` | 9 | coordinate conversions, rings, rounding, reach |
| `works.test.ts` | 15 | tool handout order, primary-yield matching, buildings, per-tile cap |
| `economy.test.ts` | 7 | storage cap on every path that adds resources, percentage effects |
| `events.test.ts` | 23 | conditions, OR rules, queueing, every event can fire and never traps |
| `deposits.test.ts` | 13 | gradient, placement, yield ceiling, surveying, harvest, glyphs |
| `save.test.ts` | 11 | round trip, encodings, old-save compatibility |
| `seasons.test.ts` | 15 | calendar, each season's effect, ice, the thaw and its penalty |
| `sites.test.ts` | 18 | sites appearing and disappearing, slots, prerequisites, demolition, site limit, buildings only at their site, gear, old-save migration |
| `i18n.test.ts` | 4 | every player-facing string has both languages |
| `camera.test.ts` | 8 | pan, zoom, clamping, hit-testing |

The convention for a regression test: make it fail with the fix reverted before
trusting it.

## Analysis scripts

| Command | Answers |
| --- | --- |
| `npm run map -- <seed>` | what does this map look like (ASCII) |
| `npm run sim -- <seed> <turns>` | one run's ledger, turn by turn, with a naive policy |
| `npm run veins` | deposit counts, first-sighting distance, density by distance band |
| `npm run balance [-- N]` | the five-part balance check below |

`sim.ts` froze silently on the first event from the day events were added until
this round — it never answered the event, and `endTurn` refuses to advance while
one is pending. Its numbers in that window were wrong. Any new script that drives
`endTurn` must resolve events.

## Balance model

The game's economy is analysed with a handful of standard formulas. Using **labour
as the common currency** — the person-turn — makes wood, stone and iron
comparable on one scale.

### The formulas

**Output per worker.** One person completes `20 / 40 = 0.5` harvests per turn,
so a worker's output is `yield × 0.5`. Tools add `bonus / 40` harvests.

**Labour price** of a resource = `1 / output per worker` on its usual terrain:
food 0.5, wood 0.4, stone 0.5 person-turns per unit. Deposit resources are joint
products (an iron miner also gets stone), so their price is an upper bound:
clay 1.0, hide 1.0, iron 0.67.

**Dependency ratio** = consumption ÷ output per farmer = `1 / 2` on grassland:
half of all labour must farm, at any party size. Wood is a flat 0.4 of a worker.
Free labour for a party of `N` is `N − N × 0.5 − 0.4`, before rounding to whole
people.

**Carrying capacity** `K` = the largest party a camp can feed, given its tiles
and the per-tile cap. Equivalent closed form for an all-grass ring:
`K ≈ slots × output per worker ÷ upkeep per person`.

**Payback period** = cost in person-turns ÷ gain per turn in person-turns.

**Runway** = stock ÷ net deficit per turn. **Migration range** = `(food ÷ N − 1)
× hexes per turn` — the `− 1` is the turn spent breaking camp.

**Expected value of an event** = chance per turn × effect; summed over the turns
its condition holds.

### Current measurements (`npm run balance`, 40 seeds)

Measured with seasons, camp sites and the base crew cap of 2 in place. Section 5
camps at the start and **never relocates**, so it says nothing about deposits or
about sites beyond the first.

**Payback.** Stone tools 9 turns; iron tools 6; the store 16. The workshop
(10.6 person-turns) is a one-off gate: a single hoe really pays back in 30 turns,
four hoes in 14.5. The other buildings return capacity rather than output
(slots, crew per tile, radius), so labour pricing cannot give them a payback; they
need a policy that actually fills the capacity.

**Start camp.** The start rings are mostly grassland (median 4–5 grass tiles).
Carrying capacity, median / worst 10%:

| Per-tile cap | Bare hands | Stone tools | Iron tools | Slots |
| --- | --- | --- | --- | --- |
| 2 | 18 / 10 | 27 / 16 | 36 / 22 | 12 |
| 3 | 27 / 15 | 40 / 24 | 48 / 33 | 18 |
| 5 | 45 / 25 | 60 / 41 | 60 / 55 | 30 |

Free labour is identical across caps up to 15 people — the cap only bites past
that. **Only 17 of 40 start rings contain any stone**, so in 58% of runs nothing
at all can be built without relocating.

**Migration.** Shortest paths cost 1.45 moves per hex: 2.8 hexes a turn, 3.4
with pack frames. The store no longer travels, so the road cap is 40, or 80 with
clay jars. On 40 food: 3 people can cover 33 hexes, 8 people 11, 12 people 6;
with jars, 69, 25 and 14.

**Sixty turns camped at the start (Monte Carlo, events on):**

| Cap | People at 15 / 30 / 45 / 60 | Idle | Shortage turns | Runs that lost someone |
| --- | --- | --- | --- | --- |
| 2 | 6 / 12 / 13 / 16 | 18% | 0.1 | 23% |
| 3 | 6 / 12 / 19 / 22 | 14% | 0.1 | 15% |
| 5 | 6 / 12 / 19 / 25 | 11% | 0.0 | 23% |

At cap 2, wanderers bring 8.7 people per run against 4 from natural growth. Hard
winter fires 4.2 times per run.

**With events off** the party is 3 / 3 / 4 / 7 at any cap, and the workshop goes
up on turn 53 and the store on turn 50 (in the 17 runs with stone at all). Before
seasons those were turns 19 and 15.

### What the numbers say

1. **Winter is real pressure.** Runs at cap 2 that lost someone went from 8% to
   23% when seasons arrived. The flat survival curve now has a tooth in it.
2. **The first year locks a party of three.** The run starts in autumn, winter
   comes on turn 21, and at three times the wood two of the three people must cut
   wood all winter. Nobody is free to quarry, and natural growth does not happen
   until spring on turn 41 — so without events, nothing gets built before turn
   ~50. The first 40 turns now lean on wanderers.
3. **Natural growth halved**: 4 a year (spring only) against 8 per 80 turns
   before.
4. **Wanderers dominate population growth** even more than before.
5. **Stone decides whether the first year has a goal.** Without stone in the
   start ring there is nothing to build until you move, and nothing on screen
   says so.
6. **Cap 2 still gives a camp a ceiling you actually reach**: about 12 people by
   turn 30. From then on *which* site you hold matters — a slot on shallows feeds
   3, on grassland 2. It is not there to push the player out: settling for good is
   a supported way to play.
7. **Cap 2 slows deposit work.** A vein pays at most once per turn without
   tools: 12 clay for jars is 6 turns on one pit, 3 iron tools about 6 turns.
8. **Spoilage is a second cap.** Food above 30 rots at 18% a turn, so the 30–40
   band is taxed about 2 food a turn — overlapping with what the storage cap
   already does.

## To do

### Design direction (agreed)

These are settled with the designer and shape everything below.

- **Judging a site is the player's job.** There is no site-evaluation feature:
  the tile panel and `?` are the information; weighing it is the game.
- **Roaming and settling are both valid for a whole run; the player chooses.**
  Finding a great spot and staying for good is a first-class way to play, and so
  is never stopping, and so is moving between a few seasonal camps. Nothing
  should force any of them.
- **No soil depletion.** It was proposed as the source of rising pressure and
  rejected, because it makes roaming mandatory. Long-term pressure comes from
  seasons and from events instead.
- **Events will scale with wealth.** The current five events are placeholders
  for the system. New ones should lean on proportional effects
  (`stockPct`, `peoplePct`) so a rich camp faces bigger trouble than a lean
  party. Check each new event's expected value in `npm run balance` section 5.
- **Seasons change systems, not numbers.** Each season changes something
  different (movement, sight, growth, fuel), each effect is on or off, and season
  effects on tile yields are avoided so the player never has to recompute income.

### Content to fill

The mechanics exist; these are placeholders waiting for real content.

- **Buildings.** The list, what each does, and every cost. Today's costs are
  stand-ins, including crew expansion, crew expansion II, outer grounds and camp
  expansion.
- **Autumn.** It has no effect yet; seasonal events were the plan.
- **Events.** More of them, using `inSeason()` and proportional effects.

### Needs a decision

- What the buildings cost, and in which resources.
- Whether a site falls after 2 years or 3 (2 is implemented).
- Where in autumn the run starts — see "the first year locks a party of three".
- Whether the start ring should be guaranteed a stone source, or the lack of one
  left as a push to relocate — and if the latter, how the game tells the player.
- Whether `?` should be genuinely uncertain. Today a `?` on hills is always iron
  and on forest or tundra always hide; only grassland is ambiguous. More deposit
  types, or overlapping terrains, would fix it.
- Selecting a site tile could outline its work ring faintly (proposed, not built;
  the building list in the tile panel is built).

### UI follow-ups

- **The resource panel needs a rework.** Six resources, each with stock, cap and
  income, are already crowding the mobile top strip. Part of the same job:
  whether to show **projected** next-turn income instead of last turn's, so
  season effects never have to be computed by hand.
- Keeping goods in a site's store for the next visit, instead of throwing away
  what no longer fits when breaking camp. Needs a per-site stock and a
  deposit / withdraw UI.

### Balance follow-ups

- The first winter: with three people and wood ×3 there is no free labour until
  spring. Options include starting earlier in autumn, a smaller winter factor in
  the first year, or a bigger starting stock of wood.
- Natural growth: spring-only halved it. Decide whether that is the intent.
- Wanderers: 3 people at 12% a turn outweigh natural growth 2:1 at cap 2 and
  more at higher caps. Fewer people, a lower chance, or a condition.
- Retune deposit yields and costs for cap 2: a single vein is slow to exploit.
- Spoilage and the storage cap do overlapping jobs.
- *Idle talk* can fire on turn 2 if the player camps and ends the turn without
  assigning anyone (20%, costs a person or 8 food) — harsh for a first turn.
- Re-run `npm run balance` after any change to yields, costs, upkeep, seasons or
  events.

### Roadmap

- Quests.
- More resource types, scattered on terrain rather than tied to it.
- Enemies (no combat today, and not necessarily ever).
- Integrate into dope-website (see CLAUDE.md for the contract).

### Tech debt

- `sim.ts` uses a naive policy and always picks the first affordable event choice;
  `balance.ts` has the better policy. Merge them, or retire `sim.ts`.
- `balance.ts` never relocates, so it cannot measure deposits, sites or seasonal
  camps. A relocation policy is the next thing it needs.
- 27 oxlint warnings: 24 × `react(refs)` in `Game.jsx` (the hook's return value
  carries refs, so every `g.x` read during render is flagged), and in
  `useHexGame.js` one mutated hook argument and two `game.version` entries in
  memo deps that the linter calls unnecessary — they are what makes the memo
  recompute after an in-place mutation, so they cannot simply be removed.
