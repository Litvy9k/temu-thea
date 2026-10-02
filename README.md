https://l9k.dev/game/
At a very early stage

# temu-thea

A hex-grid survival game on a big procedural map. Roam, make camp, assign
people to gather from the surrounding tiles, then spend what you gather on
buildings and gear. Seasons turn, winters bite, and you choose whether to keep
moving or settle. Pure front end — no backend, no network requests.

React 19 + Vite. Core logic in TypeScript, React components in JSX.

Bilingual (English / 中文). The game takes a `lang` prop; the host decides
its value — there is no language switch inside the game itself.

## Docs

- **[docs/MANUAL.md](docs/MANUAL.md)** — how the game plays: every rule and
  number, how to read the map, controls.
- **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)** — architecture, state, save
  format, rendering, the balance model, and the to-do list.
- **[CLAUDE.md](CLAUDE.md)** — why each decision was made, what breaks if it is
  undone, and how to embed the game in a host site.

## Running it

```
npm install
npm run dev        # dev server
npm run build      # emits dist/ — three static files
npm test           # 126 tests, no test framework (node:test)
npm run typecheck  # tsc --noEmit
```

Terminal tools for tuning numbers:

```
npm run map -- thermopylae   # print a map as ASCII, for tuning terrain thresholds
npm run sim -- thea 30       # one run's resource ledger, turn by turn
npm run veins                # deposit counts, first-sighting distance, density by band
npm run balance              # labour prices, payback, carrying capacity, migration range, Monte Carlo
```

## What the host can restyle

`src/game/ui/Game.css` puts its palette on `.hexgame` — `--ink`, `--ink-dim`,
`--line`, `--panel`, `--accent`, `--warn`, `--idle`.

Typeface is the other one: `--game-font`, same arrangement. Size and
line-height are not exposed — they are tuned for the density of this HUD, and
a host whose body text scales with the viewport would burst the panels.

Border thickness is the one knob deliberately *not* declared there. It is
written as `var(--line-w, 1px)` at each of the six places that draw a line, so
a host can set `--line-w` on any ancestor and every rule follows. Declaring it
on `.hexgame` would defeat that: custom properties resolve by inheritance and
the nearest declaration wins, so the game's own value would override whatever
the host set further out.

`SaveControls` is styled by the host too — its stylesheet sets layout only, no
colours or borders.
