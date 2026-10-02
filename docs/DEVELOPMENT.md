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
- [Rendering](#rendering)
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
npm test             # 90 tests, node:test, no framework
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
  works.ts         facility and tool tables, costs
  events.ts        event table and the condition evaluator
  state.ts         GameState, every action, endTurn()
  save.ts          JSON (de)serialisation with a compressed map
  rng.ts           mulberry32 with a pure step() so the RNG lives in state
src/game/render/   camera.ts (pan, zoom, culling) and draw.ts (canvas)
src/game/ui/       React — one hook (useHexGame) drives two layouts
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
| `map` | `{ width, height, seed, origin, tiles[] }` |
| `party` | `{ at, moves, people }` |
| `camp` | `null` while roaming; `{ at, crew, order }` when camped |
| `works` | `{ facilities[], tools{} }` — on the party, so it survives breaking camp |
| `turn` | 1-based |
| `stock` | current amount of each of the six resources |
| `lastIncome` / `lastShortage` / `lastWasted` | last turn's ledger, for the HUD |
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

## Turn resolution

`endTurn()` in `state.ts`, in order:

1. Refuse if `pendingEvents` is non-empty.
2. Tool allocation is computed once for the whole turn.
3. For every crewed tile: `progress += workRateAt().total`; each full 40 pays out
   `yieldsOf(terrain, deposit)`; the remainder stays on the bar.
4. Upkeep: food `people × 1 − (store ? 1 : 0)`, wood a flat 1.
5. Income is added to stock, then `clampToCap()` throws away the excess and
   records it in `lastWasted`.
6. Shortage: negative food or wood is recorded, clamped to 0, and costs one
   person; `trimCrew()` then withdraws the latest-deployed workers.
7. Otherwise on every 10th turn, +1 person.
8. Moves reset to `partyMoves()`, turn advances, `noteResources()` updates the
   HUD list.
9. `rollEvent()` rolls every qualifying event against the snapshot.

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
| `crewCap(state)` | `min(6, 2 + bonuses)` | the live cap; facilities will add here |
| `workRadius(state)` | 1 | work and survey radius; facilities will add here |

`assignBlocker()` returns `'tileFull'` at `crewCap()`. `enforceCrewCap()`
withdraws over-cap workers latest-deployed first; it runs on load, because saves
from before the cap dropped from 5 to 2 can have more people on a tile.

The choice of 2 comes from the balance measurements below.

## Rendering

`drawScene()` in `draw.ts`, back to front:

1. Terrain fills, batched into one `Path2D` per terrain (and a second set,
   overlaid with `COLORS.memory`, for explored-but-not-visible tiles).
2. Grid lines (`s ≥ 11`).
3. Terrain glyphs, then deposit marks, then deposit dots.
4. Reach shading while roaming.
5. Camp site: crew bars, progress bars, the camp ring and `⌂`; or the party dot.
6. Hover and selection outlines.

`s` is the on-screen hex size (centre to vertex) in pixels. Layout inside a hex
is the `SLOT` table, in units of `s`:

| Slot | y | Size | Drawn when |
| --- | --- | --- | --- |
| terrain glyph | −0.16 | font 0.62 | `s ≥ 13`, every tile |
| deposit glyph or `?` | +0.24 | font 0.36 | `s ≥ 20` |
| deposit dot | +0.24 | radius 0.1 | `9 ≤ s < 20` |
| progress bar | +0.44 | 0.62 × 0.07 | `s ≥ 12`, worked tiles |
| crew bars | inset 0.8 | middle 70% of each edge | `s ≥ 12`, work tiles with crew |

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

About 6KB in total. `TERRAIN_CODES` and `DEPOSIT_CODES` are append-only.

**Compatibility rule:** a new field with a safe default does not bump `v`.
`parseSave()` fills defaults: missing stock or tool entries are 0
(`fillStock`, `fillTools`), a missing deposit column means no deposits, a
missing origin falls back to the party position, an all-upper-case deposit column
(saved before surveying existed) reads as all surveyed, and over-cap crews are
trimmed. Bump `v` only when old data would be *misread*.

Every load error is a `SaveError` carrying `{ en, zh }`.

## Events

`events.ts` is a table of `{ id, text, trigger: Rule[], choices[], once? }`.

- A rule is a list of conditions on metrics (`turn`, `people`, `idle`, `camped`,
  and the six resources), AND-ed; rules are OR-ed and the **highest** matching
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
| `works.test.ts` | 15 | tool handout order, primary-yield matching, facilities, per-tile cap |
| `economy.test.ts` | 7 | storage cap on every path that adds resources, percentage effects |
| `events.test.ts` | 23 | conditions, OR rules, queueing, every event can fire and never traps |
| `deposits.test.ts` | 13 | gradient, placement, yield ceiling, surveying, harvest, glyphs |
| `save.test.ts` | 11 | round trip, encodings, old-save compatibility |
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

**Payback.** Stone tools 9 turns; iron tools 6; the store 16. The workshop
(10.6 person-turns) is a one-off gate: a single hoe really pays back in 30 turns,
four hoes in 14.5.

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
with pack frames. On a full base store (40 food): 3 people can cover 33 hexes,
8 people 11, 12 people 6. Storage and pack frames matter only for big parties.

**Sixty turns camped at the start (Monte Carlo, events on):**

| Cap | People at 15 / 30 / 45 / 60 | Idle | Shortage turns | Runs that lost someone |
| --- | --- | --- | --- | --- |
| 2 | 7 / 12 / 13 / 15 | 21% | 0.1 | 8% |
| 3 | 7 / 15 / 19 / 21 | 16% | 0.1 | 13% |
| 5 | 7 / 15 / 22 / 30 | 13% | 0.0 | 23% |

With events off, population is 4 / 6 / 7 / 9 at any cap — natural growth only.
At cap 5, **wanderers bring 19.6 people per run against 6 from natural growth**.

### What the numbers say

1. **Opening pressure is real, and then it stops.** 12 food for 3 people is 4
   turns of runway, so you must camp quickly. Once camped on the start ring,
   shortage turns are effectively zero — each farmer feeds two people at every
   party size, so upkeep never outgrows production. Survival pressure does not
   rise over time; nothing pushes the player out of the starting camp except the
   pull of deposits.
2. **Wanderers dominate population growth** (3.3× natural at cap 5). The intent
   was that decisions and events drive growth; in practice one event does.
3. **Stone decides whether the first 20 turns have a goal.** Without stone in the
   start ring there is nothing to build until you move. That could be a good push
   outward, but nothing on screen says so.
4. **Cap 2 is the one lever that gives a camp a ceiling you actually reach.** At
   cap 5 the start camp supports about 45 people, which no run reaches, so every
   site is as good as any other; at cap 2 the camp is full around turn 30. From
   then on *which* site you hold matters — a slot on shallows feeds 3, on
   grassland 2 — and iron tools, more slots or a better site are the ways up.
   This is why `BASE_CREW_CAP` is 2. It is not meant to push the player out:
   settling for good is a supported way to play.
5. **Cap 2 slows deposit work.** A vein pays at most once per turn without
   tools: 12 clay for jars is 6 turns on one pit, 3 iron tools about 6 turns.
6. **Spoilage is a second cap.** Food above 30 rots at 18% a turn, so the 30–40
   band is taxed about 2 food a turn — overlapping with what the storage cap
   already does.

## To do

### Design direction (agreed)

These are settled with the designer and shape everything below.

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

### Decided, waiting to be built

Numbers in this section are provisional; the shapes are agreed.

- **Gear and buildings, two kinds of works, split by where they live.**
  - **Gear** travels with the party: every tool (counted, one per person) plus
    the party-wide clay jars and pack frames. Everything you *craft* is gear —
    "crafting" and "gear" are the same thing, so the camp panel has one tab for
    it. Data stays on `state.works`.
  - **Buildings** belong to a **camp site** — a place on the map — and stay
    there when the party leaves. Today's **store, workshop and watchtower become
    buildings**: they are houses in the fiction, and were only portable because
    there was no fixed category when they were added. Come back, camp on the same tile, and they
    work again. This is what makes seasonal camps possible: a summer camp and a
    winter camp, each built up, visited in turn.
  - A building's effect covers the whole camp ring, never a single tile, so the
    map gains no per-tile icons. A site shows as one marker on the map.
  - Each site has a limited number of building slots, so one site cannot be
    grown forever; past that, the party grows through gear.
  - **A site collapses after 2–3 years (160–240 turns) without a visit.** Seasonal
    circuits stay standing; a trail of one-off camps clears itself. It also bounds
    save size.
  - Design rule: a building pays off once the total time spent at that site —
    across every visit — exceeds `cost ÷ gain per turn`.
  - Consequences of moving store, workshop and watchtower to buildings:
    - Crafting needs a workshop **at the current site**. Gear already made works
      anywhere.
    - The store's storage +40 and food upkeep −1 apply only while camped at its
      site. On the road, storage is the base 40 plus clay jars — **clay jars
      become the migration item**, which fits clay's role (storage). The
      migration-range table in the balance model must be recomputed: large
      parties now need jars, not a store, to travel far.
    - Breaking camp at a site whose store raises the cap drops the cap. Whatever
      no longer fits is thrown away, after a confirmation that names the amounts
      ("breaking camp throws away 23 food"). Keeping goods in the store for the
      next visit is a possible later feature; it needs a per-site stock and
      deposit/withdraw UI.
    - Watchtower sight +1 applies only at its site.
    - Old saves: store, workshop and watchtower in `works.facilities` move into a
      new site at the party's current position on load.
    - The settled rule in CLAUDE.md, "facilities and tools hang off the party",
      becomes "gear hangs off the party, buildings hang off the site". The reason
      it exists — no stash-and-restore step — still holds for both.
  - Camp panel: two tabs, **Buildings** and **Gear** (gear is where crafting
    happens; tools and party gear are two groups inside it).
- **Data model for sites: buildings live on the site, the camp only points at
  it.** `map.sites: { at, buildings[], lastVisit }[]`; `camp.site` refers to one.
  Breaking camp nulls `camp` as today and the site simply stays. Making camp on a
  tile that has a site attaches to it; a site is created by the first building,
  so camps that never built anything leave no record. **Never copy buildings
  between the camp and the site** — the reason gear lives on the party (no
  stash-and-restore step where a field gets forgotten) applies here too.
  Cost: a lookup by position when camping and a few markers per frame; about 50
  bytes per site in a save, so even 100 sites is about 5KB on top of today's 6KB.
- **Seasons.** 20 turns per season, an 80-turn year, and the run **starts in
  autumn** so the first winter arrives once the first camp is standing. A year
  must be long enough that a relocation (about 4–5 turns: break camp, 2–3 turns
  of travel, settling in) is no more than a quarter of a season. Each season
  changes a different system, and every effect is on/off rather than a number
  the player has to multiply:
  - spring: marsh move cost 3 → 5 (not impassable, so nobody is stranded in a
    marsh); natural growth happens in spring
  - summer: sight +1
  - autumn: seasonal events
  - winter: fire wood ×3; **all shallows freeze and can be walked on**; ice
    cannot be camped on
  - a `season` metric for event conditions
  - HUD, desktop: a row under the turn counter, `季节  ❄ 冬 7/20`. Mobile: on
    the right of the top strip's first line, which only holds the turn and the
    roaming/camped state today. Same `7/20` (elapsed / length) in both — one
    thing to learn.
  - The season character and its icon are coloured per season, avoiding the
    three colours that already mean something (accent green = income and geared
    crew, `#ff8b6b` = shortage, `#ffc98c` = idle): spring `#f0a6c8`, summer
    `#b5d86a`, autumn `#e0a24e`, winter `#8fc8f0`. **Agreed.**
  - **Season icons** — flower, sun, leaf, snowflake — drawn before the season
    character at 1em. Source: [`docs/season-icons.svg`](season-icons.svg), a
    16×16 grid, all `currentColor`, so setting `color` on the element colours it.
    No masks and no ids inside the shapes, so they can be inlined repeatedly;
    partial fills use group opacity so overlapping petals do not darken. Checked
    at 13px: all four tell apart. The flower petals sit at 75% — at 55% they read
    grey-purple on the dark panel instead of pink. These are the first SVGs in
    the HUD (everything else is a text glyph): emoji-capable code points such as
    `☀` and `❄` can render as colour emoji and ignore CSS colour, which is why
    they are drawn rather than typed.
  - Hovering (desktop) or tapping (mobile) the season shows its active effects,
    e.g. "fire wood ×3 · shallows frozen".
  - **A season change is announced by a non-blocking notice**, not an event
    dialog: it shows the new season and its effects, never stops End turn, and
    fades on its own. It must not take pointer events over the map, and stays
    within the game's z-index ≤ 2 (see the host contract in CLAUDE.md).
  - Ice shows cracks in its last turns.

  A 20-turn winter at ×3 burns 60 wood against a base cap of 40, so a winter
  cannot be sat out on stockpile alone: a winter camp needs forest, or more
  storage. That falls out of the numbers; nothing else enforces it.
- **Stranded on thawed water.** When the ice melts, a party still on it is on an
  impassable tile.
  - A party that **starts its turn** on a thawed shallow may enter other thawed
    shallows that turn; any other party may not. The exemption covers thawed
    shallows only — never ocean or mountains, or a stranded party could walk
    across the sea or over a range. Wading costs 2 moves per tile (impassable
    tiles have no move cost today; it needs one).
  - At the **end** of each turn still on such a tile: lose 0–2 people and 10–30%
    of every resource, rounded up, rolled on `state.rngState`. A party that walks
    ashore on the first turn after the thaw pays nothing. Small parties die
    faster than big ones, which is intended.
  - It is a rule in `endTurn`, like starvation, not an event: event effects are
    fixed numbers and it offers no choice.

- **A facility that raises the per-tile cap.** Hook: `crewCap()`. Cap ceiling is 6.
  Cost and resource not decided yet.
- **A facility that widens the work and survey radius.** Hook: `workRadius()`.
  Radius 2 is 18 work tiles — at cap 6 that is 108 slots, triple anything today,
  so this belongs late and should be expensive. Cost not decided.
- **Site evaluation while roaming** — what a candidate camp is worth before you
  commit a turn to it. Deposits and `?` make this necessary.

### Needs a decision

- What the two facilities above cost, and in which resources. (Parked by choice.)
  Also whether they become gear or buildings — as buildings they reward
  holding a site, as gear they travel.
- The list of buildings, what each does, and how many slots a camp has.
- Whether a site collapses after 2 years or 3.
- The exact start turn within autumn — measure once seasons exist.
- Whether the start ring should be guaranteed a stone source, or the lack of one
  left as a push to relocate — and if the latter, how the game tells the player.
- Whether `?` should be genuinely uncertain. Today a `?` on hills is always iron
  and on forest or tundra always hide; only grassland is ambiguous. More deposit
  types, or overlapping terrains, would fix it.

### UI follow-ups

- **The resource panel needs a rework.** Six resources, each with stock, cap and
  income, are already crowding the mobile top strip. Part of the same job:
  whether to show **projected** next-turn income instead of last turn's, so
  season effects never have to be computed by hand.

### Balance follow-ups

- Wanderers: 3 people at 12% a turn outweighs natural growth 3:1. Fewer people,
  a lower chance, or a condition (only when food is plentiful).
- Retune deposit yields and costs for cap 2: a single vein is slow to exploit.
- Spoilage and the storage cap do overlapping jobs.
- *Idle talk* can fire on turn 2 if the player camps and ends the turn without
  assigning anyone (20%, costs a person or 8 food) — harsh for a first turn.
- Re-run `npm run balance` after any change to yields, costs, upkeep or events.

### Roadmap

- Quests.
- More resource types, scattered on terrain rather than tied to it.
- Enemies (no combat today, and not necessarily ever).
- Integrate into dope-website (see CLAUDE.md for the contract).

### Tech debt

- `sim.ts` uses a naive policy and always picks the first affordable event choice;
  `balance.ts` has the better policy. Merge them, or retire `sim.ts`.
- `balance.ts` never relocates, so it cannot measure anything about deposits
  beyond distance. A relocation policy would let it.
- 21 pre-existing oxlint warnings: 18 × `react(refs)` in `Game.jsx` (refs read
  during render), and in `useHexGame.js` one mutated hook argument and two
  `game.version` entries in memo deps that the linter calls unnecessary — they
  are what makes the memo recompute after an in-place mutation, so they cannot
  simply be removed.
