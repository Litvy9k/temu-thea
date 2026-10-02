# temu-thea

A hex-grid survival game on a big procedural map. React 19 + Vite, fully
static — no backend, no network requests. Core logic in TypeScript, React
components in JSX.

Player-facing rules are in `docs/MANUAL.md`; the technical reference, the
balance model and **the to-do list** are in `docs/DEVELOPMENT.md`. This file
records **why each decision was made**, and **what goes wrong if you undo it**.
When a rule changes, update all three.

Source comments are in Chinese; these docs are in English.

## Architecture

```
src/game/            portable boundary: drops into any React project as-is
  core/              pure logic, no DOM, runs directly under node
    hex.ts           hex math
    map.ts           map storage (odd-r flat array) and noise generation
    terrain.ts       terrain table
    deposits.ts      deposit table and the distance gradient
    seasons.ts       calendar and season effects (derived from the turn)
    works.ts         building, gear and tool tables
    state.ts         state and rules
    save.ts          save serialisation
  render/            camera.ts camera and culling, draw.ts canvas drawing
  ui/
    useHexGame.js    interaction logic — one "brain" shared by both layouts
    Game.jsx         four jobs only: mount canvas, measure width, pick layout,
                     place the camp panel
    DesktopLayout    floating panels  /  MobileLayout  top strip + thumb dock
    CampPanel        buildings + gear, an on-demand drawer
    Overlays.jsx     confirmation dialog (blocks) and notices (never block)
    parts.jsx        display pieces shared by both layouts
    SaveControls     new game / save / load
src/App.jsx          dev shell, thrown away on integration
scripts/             dump-map.ts prints an ASCII map, sim.ts runs the economy
                     ledger, veins.ts measures deposit density by distance,
                     balance.ts runs the five-part balance check
docs/                MANUAL.md (player rules), DEVELOPMENT.md (tech + to-do)
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

**Gear hangs off the party (`state.works`); buildings hang off a camp site
(`map.sites`). Neither is ever copied.** Works are split by where they live:
tools, clay jars and pack frames travel; store, workshop, watchtower and the rest
stay where they were built. Breaking camp nulls `camp`, the gear is still on the
party, and the site is still on the map — so "gear survives", "buildings stay
behind" and "come back and they work again" all fall out of the data model with
**no carry-over logic**. A "stash the buildings before breaking camp, restore them
after" step is exactly where a field gets forgotten later.

**The camp finds its site by position, not by a pointer.** `currentSite()` looks
up the site whose `at` equals `camp.at`. Sites can fall down or be demolished;
a stored reference would go stale, a position cannot.

**Buildings only work at their own site.** Everything reads `hasBuilding()`,
which looks at the current site. A store's +40 storage stops counting when you
camp elsewhere, which is why breaking camp can throw goods away — and why that is
confirmed first, naming the amounts (`breakCampLoss()`).

**The site limit blocks the first building at a new place, never making camp.**
Camping creates no site, so blocking it would leave a party that already has five
sites unable to work anywhere else.

**The season is derived from the turn, never stored.** `seasonAt(turn)`. A
stored season is a second source of truth that can disagree with the turn and has
to be validated on load.

**Seasons change systems, and every effect is on or off.** Spring changes
movement and growth, summer sight, winter fuel and the shape of the coast. None
of them scales tile yields — that would make the player recompute income every
season. Movement cost, seasons included, is decided in exactly one place:
`stepCost()`.

**The thaw never strands anyone forever, and never erases a shortage.** A party
that starts a turn on thawed water may wade into other shallows (never the sea or
mountains — otherwise it could walk across the ocean), and pays 0–2 people and
10–30% of its stock for each turn it ends there. The penalty takes only
**positive** stock: it runs before the shortage check, when a short resource is
negative, and a share of a negative number rounded up is a negative loss — which
silently refills the deficit and cancels the famine. A test pins it.

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

**A tool only applies to a tile whose *primary* yield it boosts.**
`primaryYields()` in `terrain.ts` returns the highest-valued resource on a tile
(ties count as several). Matching on "does this tile produce the resource at all"
is wrong: forest is `food 1 + wood 5`, so a food tool would attach to loggers.
A tool follows what a patch of land is *for*, not its leftovers.

**Deposits are a property of the tile, not of the terrain.** `deposits.ts`
holds a second layer that sits on top of `terrain.ts`: terrain says what a
patch of land *is*, a deposit says what happens to be *in* it. Same mountain,
but only the one with an iron vein is worth the walk — and unlike terrain, you
cannot tell from a distance, you have to explore it. `yieldsOf(terrain,
deposit)` is the single source of a tile's output and **every reader must go
through it**: turn resolution, the tile panel and tool matching each read it
separately, and a path that misses it shows up only as "the panel says iron but
the stock did not move". There is a test for exactly that.

**A deposit's yield may tie the terrain's primary but never exceed it.** Tools
attach to a tile's *primary* yield, so a deposit that outweighs the terrain
silently changes what the land is "for" and detaches every tool from it. This
is not hypothetical: clay was drafted at 4 while marsh is food 2 + wood 2, which
took both the axe and the hoe off every marsh clay pit, with no symptom beyond
"tools don't seem to work on that tile". The practical ceiling is the **lowest**
primary among a deposit's allowed terrains — clay is capped by marsh (2), game
trails by tundra (2), iron by hills (4). `deposits.test.ts` asserts it at the
table level rather than per tile, so a new deposit is checked the moment it is
added.

**Deposits get denser the further you are from the spawn point, and the spawn
point lives on the map.** `map.origin` is fixed at generation, before any
deposit is placed, because it is the centre of the gradient — it belongs to the
world, not to the party, which walks away from it. Each deposit has its own
onset distance (`near`) and reaches full density at `far`; nothing at all spawns
inside the camp working radius, or the whole outward arc would be skipped on
turn one. This is the only thing in the game that makes the far map worth
reaching, and with no combat the "danger" out there is purely logistical: a
travelling party produces nothing while it walks.

The numbers in that table are guesses; only `npm run veins` is evidence. It
prints per-seed counts, the distance to the nearest of each kind, **and a
density histogram by distance band** — the band table is the one that matters,
because raw counts always rise outward simply because outer rings have more
tiles. A first pass looked reasonable on counts and was nearly flat on density.
One artefact worth knowing: iron thins out again past distance 30, because the
map's radial falloff turns the outer rim into coast and lowland, so there are
barely any hills left out there to put it in.

**Seeing a deposit and surveying it are two different things.** Sight reveals
that a tile *has* a deposit (drawn as `?`); the tile is `surveyed` — and the
deposit identified — only once the party has been within `workRadius()` of it,
roaming or camped. `surveyed` is append-only, like `explored`.

**The survey radius *is* the work radius — one function, `workRadius()`.** That
is what guarantees you can never assign someone to an unsurveyed tile: every
workable tile is next to the camp, the camp is where the party stands, and
`refreshVision()` has already surveyed that ring. There is no explicit check
anywhere, only that shared number and a test. Split the two radii and the symptom
is a worker harvesting a resource the player has never been shown.

**Resources appear in the HUD once the player has held some or *surveyed* a
deposit of it** (`state.seenResources`, append-only). Six rows do not fit a
phone in portrait, and a row reading 0 for twenty turns is noise. The trigger
was briefly "seen", which put the answer to every `?` straight into the resource
bar — it has to be survey. `describeHex()` hides unsurveyed deposits from the
tile panel for the same reason, yields included. The list is stored rather than
derived from `stock > 0`, because a derived row would vanish the moment the
player spends the last of something.

**Inside a hex, every element has a fixed slot (`SLOT` in `draw.ts`), and
nothing overlaps.** Terrain glyph a little above centre on *every* tile, deposit
slot below it, progress bar below that, crew bars around the edge. The terrain
glyph sits high even on tiles with no deposit, or tiles with one would jump.

This took three tries. The deposit marker started in the top-right corner, where
the crew dots' dark pad covered it — on exactly the tiles that had people on
them. It then replaced the terrain glyph in the centre with a coloured inset ring
for zoomed-out scanning; the ring then had to go when crew moved to edge bars,
because both lived in the same inset band. Zoomed-out scanning is now a dot in
the deposit slot (`9 ≤ s < 20`), which needs no band of its own.

Deposit glyphs are drawn smaller than terrain glyphs and prefer outline forms:
terrain symbols are hairline (`·` `♣` `∩`), and a solid shape at the same weight
reads as a colour block. Clay was `▰` and became `▱`. **A deposit's glyph must
equal its resource's glyph** — clay once showed `▱` on the map and `▰` in the
HUD; a test now checks it.

**Crew are six bars along the six edges, and that is why the cap's ceiling is
6.** One bar per person makes the count readable without digits; a seventh
person would have nowhere to go, so `MAX_CREW_PER_TILE = 6` is geometric, not a
balance number. The live cap is `crewCap()`, starting at `BASE_CREW_CAP = 2`.
Bars fill clockwise from the upper-right edge on every tile (a start edge that
followed the camp's direction could not be counted at a glance), and leave a gap
at each corner so five and six bars look different. Locked slots are dashed:
hatching or a wave cannot be seen on a bar two or three pixels thick. **Bars
appear only on tiles with someone on them**; empty work tiles get the faint
outline. Bars on every work tile filled the whole ring the moment you camped,
and the tiles actually being worked stopped standing out.

**Why the base cap is 2 is a measurement, not a taste** — see the balance model
in `docs/DEVELOPMENT.md`. At cap 5 the start camp feeds about 45 people and no
run ever reaches that, so every site is as good as any other; at 2 the camp
fills around turn 30, and from then on *which* site you hold matters. It is not
there to push the player out — settling for good is a supported way to play
(see "Design direction" in `docs/DEVELOPMENT.md`). Below 15 people the cap changes nothing, because start rings are
mostly grassland with slots to spare. Lowering the cap does not touch old saves'
crews by itself — `enforceCrewCap()` runs on load and withdraws the
latest-deployed workers first, the same order `trimCrew()` uses on a death.

**Tool display order and tool handout order are two different lists.**
`TOOL_ORDER` is the crafting menu, cheapest tier first; `TOOL_PRIORITY` is who
gets what, best first, so the earliest-deployed person takes the iron axe. They
were one list at first, which put an unmakeable iron axe at the top of the
crafting page on turn one.

This also makes adding resources self-resolving — a new terrain's primary yield
decides which tools reach it, with no separate lookup table to maintain. Hills
and mountains (primary stone) have exactly one tool, the iron pick.

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

**Stocks are capped, and everything that adds to them goes through
`clampToCap()`.** Without a cap, wood measured 1474 by turn 80 — a number, not
a decision. With one, every turn of surplus has to be **spent or thrown away**,
which is what makes buildings, gear and every future sink matter. It also fits
the fiction: a nomadic party carries what it can lift.

The danger is a path that adds resources without clamping — turn resolution
clamps but an event reward does not, and that event silently becomes a way
around the cap. `economy.test.ts` asserts each adding path separately. **Waste
is shown in the HUD**; hidden waste reads as "income says +19 but the stock did
not move", which players report as a bug.

**Event effects can be proportional (`stockPct`, `peoplePct`).** Some losses are
inherently a fraction — spoilage rots *part* of the store, not a fixed ten. The
percentage is taken from the stock **before** the same effect’s absolute terms
are applied, so writing order cannot change the result, and it always removes at
least 1 when there is anything to take: rounding to zero is the most confusing
kind of "it fired but nothing happened".

**Events: every qualifying event rolls, all hits queue, table order is the pop
order.** `events.ts` holds the table; `state.ts` rolls at the end of `endTurn`
and pushes each hit onto `state.pendingEvents`. The turn stays blocked until the
queue empties.

**Trigger conditions are judged once, on the snapshot taken at the turn
boundary; choice `require` is judged live.** Re-checking triggers between
dialogs would let event B vanish because of what the player picked in event A —
unexplainable on screen. But the resources A just spent must be visible to B, so
`choiceAllowed()` reads current state every time.

**OR-ed rules take the highest chance.**
Within a rule the conditions are AND-ed; between rules they are OR-ed, and when
several rules hold the **highest** chance wins rather than the sum — summing
would mean "the more conditions you write, the more often it fires", which the
person writing the table cannot predict.

**Every event needs at least one choice with no `require`.** A pending event
blocks `endTurn`, so an event whose choices are all unaffordable would freeze the
run. A test enforces it, along with "every event in the table can actually fire"
— a self-contradictory condition is invisible in code and only shows up as an
event that never appears.

**The event RNG lives in `state.rngState`, not `Math.random()`.** Events have to
be reproducible from a seed, testable, and consistent across a save/load — a
global RNG loses all three. `rng.ts` exposes `step()` as a pure function for
exactly this; `mulberry32()` is built on it so there is only one generator.

**`camped` is a 0/1 metric, not a second kind of condition.** Whether the party
has camped is a boolean, but giving it its own condition shape would mean a
second evaluator, a second set of validation and a second set of tests, and buy
only a few characters at the call site. The exported `CAMPED` / `ROAMING`
constants keep the table readable without any of that.

**The `idle` metric is 0 while roaming.** `idleCount()` is "people minus
assigned", and with no camp nothing is assigned — read literally, everyone is
idle forever and "the idle ones talk about leaving" fires on turn 2, before the
player has even camped. Roaming is not idling.

**Both languages are hardcoded at the point of use; the game never owns the
switch.** `i18n.js`, `terrain.ts`, `works.ts` and the `SaveError` throws all
carry `{ en, zh }` pairs inline — no translation files, no i18n library, no
provider. `Game` and `SaveControls` each take a `lang` prop and the host decides
its value. There is deliberately **no language control inside the game**; see the
integration section below for the exact contract.

English copy is **sentence case** — first word capitalised, the rest lower, never
Title Case. The one exception is a word used as a suffix after a number or as a
parenthetical annotation (`1 idle`, `(tools +20)`), which stays lowercase: a
capital there reads as the start of a new sentence.

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

**Any script that drives `endTurn()` must answer events.** `endTurn` refuses
to advance while an event is pending. `scripts/sim.ts` never answered them, so
from the day events were added it froze on the first one — the turn number
stopped, and every later row was a copy. It printed plausible numbers the whole
time. `balance.ts` throws if a turn fails to advance; do the same in anything new.

**A balance tool must not go through the cap it is measuring.** `balance.ts`
compares per-tile caps 2, 3 and 5; driving it through `assign()` would clamp
every variant to the real cap of 2 and print three identical rows. It places
workers itself.

**`.hexgame b` colours every `<b>` accent green.** Its specificity (0,1,1) beats
a single class (0,1,0), so a `<b class="…">` that sets its own colour loses. The
season notice's title came out green instead of the season's colour; it is a
`<span>` now. Use `<span>` for emphasis that carries its own colour.

**Anything placed under the mobile status strip must hang off the strip, not a
fixed `top`.** The strip's height depends on how many resource rows it holds.
Notices were first placed at a fixed 84px and landed on a 105px strip; they are
now children of `.hg-m-status`, positioned from its bottom edge.

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
- **A dev server started with the Browser pane's `preview_start` is stopped when
  the assistant's turn ends.** If the user wants to play with it, start
  `npm run dev` as a background shell task instead, then point the pane at
  `localhost:5173`.
- **The Browser pane's screenshots are a 1.5× crop of the page; clicks take CSS
  pixels.** Something drawn at (697, 470) in a screenshot is clicked at
  (465, 313). Clicking at screenshot coordinates lands somewhere else, silently.
  Check `window.innerWidth` and `devicePixelRatio` if clicks seem to do nothing.

## When integrating into dope-website

### What to mount

Copy `src/game/` into `frontend/src/game/` as-is and throw away `src/App.jsx` —
the site has its own layout and routing. Two components go on the page:

```jsx
import { useRef, useState } from 'react';
import Game from '../game/ui/Game.jsx';
import SaveControls from '../game/ui/SaveControls.jsx';

function GamePage({ lang }) {              // lang comes from the site's own state
  const [session, setSession] = useState(() => ({ id: 0, seed: null, state: null }));
  const stateRef = useRef(null);           // Game writes the live state here

  return (
    <>
      <SaveControls
        lang={lang}
        getState={() => stateRef.current}
        onNew={() => setSession((s) => ({ id: s.id + 1, seed: null, state: null }))}
        onLoad={(state) => setSession((s) => ({ id: s.id + 1, seed: null, state }))}
      />
      <div style={{ height: 'min(80vh, 900px)' }}>
        <Game
          key={session.id}                 // changing the key restarts or loads
          seed={session.seed}              // null = random
          initialState={session.state}     // set by onLoad, otherwise null
          stateRef={stateRef}
          lang={lang}
        />
      </div>
    </>
  );
}
```

`SaveControls` is optional and can sit anywhere on the page — it only needs
`getState` and the two callbacks. Its CSS sets layout only, no colours or
borders, so it inherits whatever button styling surrounds it.

### The language interface

| | |
| --- | --- |
| Prop | `lang`, on both `Game` and `SaveControls` |
| Values | `'en'` or `'zh'` |
| Default | `'zh'` if omitted |
| Where strings live | `game/i18n.js`, plus `{ en, zh }` labels in `terrain.ts`, `deposits.ts`, `works.ts`, `seasons.ts`, `events.ts` and the `SaveError` throws |

Pass the site's current language straight through; the game renders it and owns
nothing else about language.

**Changing `lang` must not change `key`.** `lang` is only read during render, so
switching it re-renders in place and a game in progress survives untouched.
Remount on a language switch and the player loses their run.

Adding a third language means adding a third key to every `{ en, zh }` pair.
There is no fallback chain beyond `t()` falling back to `en`.

### Sizing

`Game` fills its parent (`width: 100%; height: 100%`, `min-height: 420px`), so
**the parent must have a definite height**. A bare `<div>` in normal flow
collapses and the canvas comes out zero pixels tall. Give it a fixed height, a
viewport unit, or a flex/grid track.

Layout mode comes from the width of the game's own container, not the viewport:
under 720px it switches to the narrow layout, and between 720 and 988px the camp
panel overlays instead of taking a column. Dropping the game into a narrow column
on a wide screen therefore does the right thing with no configuration.

### Notes from that repo's own CLAUDE.md that apply directly

- **The font subset is generated at build time by scanning `content/` and
  `src/`.** Chinese written literally in the source is fine, but **text assembled
  or generated at runtime** (random place names, numbers glued to units) is not
  scanned, so it renders with missing glyphs in production — and never locally,
  where the full font is installed. All game copy is literal today; watch this
  when adding generated text.
- **z-index:** the site's bottom bar is 1000 and tooltips are 1200. Everything the
  game draws stays inside its own container. The two dialogs (events,
  confirmation) use z-index 5 and everything else at most 2, so all of it sits
  under both. Revisit this if the game ever needs a modal that covers the page.
- **Do not use `100vw`** (it includes the scrollbar). The game measures itself
  with `clientWidth` through a ResizeObserver and needs no viewport units.
- The site is plain JS with oxlint, which is why **core logic is `.ts` and React
  components are `.jsx`** — its lint only ever sees `.jsx` and needs no
  typescript-eslint. Keep that split when adding files.
- `tsconfig.json` and the `typecheck` script have to come along too, otherwise
  the `.ts` files are only type-*stripped* and never type-*checked*.
- The preview environment does not composite frames, so time-based animation
  cannot be verified there; only end states can.

### What the game does not need

No backend, no API, no environment variables, no web fonts, no images, no
external requests of any kind. The build is JS + CSS only, and every glyph on
the map is a text character drawn to canvas with the system monospace stack.
