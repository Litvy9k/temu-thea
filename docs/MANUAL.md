# temu-thea — player's manual

How the game works, from the player's side. Every number here is the live value
in the code; if they ever disagree, the code is right and this file is stale.

Technical details and the to-do list are in [DEVELOPMENT.md](DEVELOPMENT.md).

## The idea

You lead a small band of people across a big unexplored map. You can either
**roam** (move, but nobody works) or **camp** (work the land around you, but
stay put). Keep everyone fed and warm through the winters, grow the party, build
up your camps and your gear.

How you play is up to you: keep moving and never settle, find one great spot and
stay for good, or keep a summer camp and a winter camp and move between them. The
game supports all three.

There is no win condition yet. The run ends when everyone is gone.

## A turn

You move or assign work, then press **End turn**. At the end of each turn, in
this order:

1. Every worked tile advances its harvest bar, and full bars pay out.
2. Upkeep is paid: food for every person, wood for the fire.
3. Anything above the storage cap is thrown away.
4. If you are standing in thawed water, you pay for it (see *Caught in the thaw*).
5. If food or wood ran short, **one person dies**.
6. In spring, every 5th turn, if nobody went short, **one person joins**.
7. Events roll, and any that fire are shown one at a time before the next turn.

## Seasons

A year is **80 turns**: four seasons of 20. The run starts on the first day of
**autumn**, so your first winter arrives on turn 21.

| Season | What changes |
| --- | --- |
| Spring | Marshes flood: moving into one costs 5 instead of 3. Natural growth happens only now — one person every 5 turns. |
| Summer | Sight +1, for the party and for camps. |
| Autumn | Nothing special yet (seasonal events are planned). |
| Winter | The fire burns **three times** the wood. **Shallows freeze** and can be walked on. |

The current season is shown as `❄ 冬 7/20` — the season's icon and name in its
colour, then the day of the season. Hover it (desktop) or tap it (touch) to see
what the season changes. When a season turns, a short notice says so; it never
blocks anything and fades on its own.

A winter of 20 turns burns 60 wood, more than a base store of 40 can hold, so you
cannot simply stockpile your way through it: a winter camp wants forest nearby,
or more storage.

### Ice

In winter, shallows turn to ice (drawn pale blue, `=`). Ice can be walked on for
2 moves, which opens routes across bays and straits that are water the rest of the
year. **You cannot make camp on ice.** In the last 3 turns of winter the ice
shows cracks (`≠`) — time to get off.

### Caught in the thaw

If winter ends while you are standing on ice, you are in the water. That turn you
may still wade into other shallows (2 moves each) — but never into the open sea or
onto mountains — and you choose which way to go.

At the **end of every turn you are still in the water**, you lose **0–2 people**
and **10–30% of every resource** (rounded up). Get ashore on the first turn after
the thaw and you pay nothing. A small party can be wiped out in a few turns.

## Roaming and camping

The two are mutually exclusive.

| | Roaming | Camped |
| --- | --- | --- |
| Move | 4 moves per turn (5 with pack frames) | no |
| Work the land | no | yes, the tiles around the camp |
| Build and craft | no | yes |
| Upkeep | paid in full | paid in full |

**Making camp** needs at least one move left this turn, so you cannot walk your
full distance and start working on the same turn. **Breaking camp** uses up the
rest of the turn's moves. Relocating therefore always costs at least one turn in
which nobody works.

Your **gear** comes with you when you break camp. **Buildings** stay where they
are — see *Camp sites*.

## Gathering

When camped, the tiles around the camp are your **work tiles** (the six next to
it; with *outer grounds*, every tile within 2). Click (tap) a work tile to send
one idle person there; use **−** / **+** in the tile panel to adjust, or
right-click to recall on desktop.

- Every tile has a **harvest bar** that fills to 40.
- Each person pushes it **20 per turn**, so one person completes a harvest every
  two turns.
- A full bar pays out the tile's yield. Progress **overflows**: 50 is one harvest
  with 10 carried over.
- Each tile holds **2 people** to start. *Larger crews* raises it to 4, and
  *larger crews II* to 6 — the most a tile can ever hold, one per edge.
- Progress stays on the tile when you leave. Come back later and it is still
  there.

### Tools

A tool adds to the progress of the person holding it: **+10** for stone tools,
**+20** for iron ones — an iron tool is worth a whole extra pair of hands.

Tools are counted, one per person, and **handed out in deployment order**: with
one axe, the first person you sent into the woods gets it. Where two tools fit,
the better one goes first.

A tool only helps on a tile whose **main** yield it matches. A forest gives a
little food, but it is wood land, so a hoe does nothing there.

## Upkeep

| | Cost | Notes |
| --- | --- | --- |
| Food | 1 per person per turn | a store at this camp saves 1 per turn in total |
| Wood | 1 per turn, **3 in winter** | flat — the fire burns the same for 3 people or 30, roaming or camped |

Running short of either costs one person that turn.

## Storage

Every resource is capped at **40**. A **store** adds 40 while you are camped at
its site; **clay jars** add 40 wherever you are. Anything gathered past the cap is
thrown away, and the resource bar shows how much in red.

Because the store stays behind, breaking camp at a site with a store can lower
your cap. If that would throw anything away, the game asks first and tells you
exactly how much.

## Terrain

| Terrain | Move cost | Yield per harvest | Sight |
| --- | --- | --- | --- |
| Grassland `·` | 1 | 4 food | 2 |
| Forest `♣` | 2 | 5 wood, 1 food | 1 |
| Hills `∩` | 2 | 4 stone, 1 food | 3 |
| Marsh `"` | 3 (5 in spring) | 2 food, 2 wood | 1 |
| Tundra `,` | 1 | 2 food | 3 |
| Desert `˙` | 1 | nothing | 3 |
| Shallows `~` | impassable (ice in winter: 2) | 6 food | — |
| Mountains `▲` | impassable | 6 stone | — |
| Ocean `≈` | impassable | nothing | — |

Shallows and mountains can be worked from a camp next to them. Sight is how far
you see standing there; a camp always sees 2 (3 with a watchtower), and summer
adds 1 to both.

**No terrain is rich in both food and wood.** A good camp needs both nearby.

## Resources

| | | Comes from | Used for |
| --- | --- | --- | --- |
| Food | ✦ | grassland, shallows, tundra… | eating — every person, every turn |
| Wood | ❙ | forest, marsh | the fire, and most building |
| Stone | ◆ | hills, mountains | buildings and stone tools |
| Clay | ▱ | clay pits | clay jars |
| Hide | ◗ | game trails | pack frames |
| Iron | ◈ | iron veins | iron tools, larger crews II |

The resource bar starts with food, wood and stone. The others appear the first
time you survey a deposit of them or hold some.

## Deposits

Clay, hide and iron do not come from terrain. They come from **deposits** sitting
on top of it:

| Deposit | Found on | Adds per harvest |
| --- | --- | --- |
| Clay pit `▱` | marsh, shallows, grassland | 2 clay |
| Game trail `◗` | forest, tundra, grassland | 2 hide |
| Iron vein `◈` | hills, mountains | 3 iron |

A deposit adds to what the tile already gives: an iron vein in the hills is still
4 stone, **plus** 3 iron.

**Deposits get commoner the further you are from where you started.** There are
none next to your starting camp. Clay pits turn up within a few tiles, game
trails a bit further out, and iron further still.

### Surveying

Seeing a deposit from a distance only tells you *something is there* — it shows
as a **`?`**. To find out what it is, walk next to it: any tile within your work
reach is **surveyed**, whether you are roaming past or camped. Once surveyed, a
tile stays surveyed. You can never assign people to an unsurveyed tile.

## Camp sites and buildings

**Buildings** belong to the place you built them — a **camp site**. Break camp and
they stay there; come back and camp on the same tile and they work again. Camp
anywhere else and you do not have them.

- A camp becomes a site when you put up its **first building**. A camp where you
  built nothing leaves nothing behind.
- You can have **at most 5 sites**. With five, you can still camp anywhere and
  work — you just cannot start building at a new place. To free one, demolish
  everything at a site, or let one fall.
- **A site nobody has camped at for 2 years (160 turns) falls down and is gone.**
  There is no warning. Camping there resets the clock; walking past does not.
- Each site has **3 building slots**. *Camp expansion* opens it to **6**, and does
  not take a slot itself. Some buildings take no slot (marked in the list).
- A stronger building may **require** another one at the same site.
- You can **demolish** a building for half its cost back (rounded down). A
  building that another one depends on cannot be demolished — and camp expansion
  stays while slots 4–6 are in use.

On the map, a site you are not camped at has a **grey hexagon inset with solid triangles in three corners** in its
tile. It hides while people are working that tile from a neighbouring camp.
Selecting the tile lists the buildings in the tile panel.

| Building | Cost | Effect | Slot |
| --- | --- | --- | --- |
| Store | 12 wood, 6 stone | storage +40, food upkeep −1 | yes |
| Workshop | 14 wood, 10 stone | gear can be made here | yes |
| Watchtower | 10 wood, 8 stone | camp sight +1 | yes |
| Outer grounds | 30 wood, 20 stone | work and survey radius +1 | yes |
| Camp expansion | 24 wood, 16 stone | slots 3 → 6 | no |
| Larger crews | 16 wood, 10 stone | crew per tile +2 | no |
| Larger crews II | 20 wood, 14 stone, 4 iron | crew per tile +2 more; needs larger crews | no |

These costs are placeholders.

## Gear

Everything you make is **gear**, and gear travels with you. Making gear needs a
**workshop at the camp you are in**.

| Gear | Cost | Effect |
| --- | --- | --- |
| Clay jars | 6 wood, 12 clay | storage +40, wherever you are |
| Pack frames | 6 wood, 10 hide | moves +1 while roaming |
| Stone axe | 6 wood, 4 stone | wood tiles +10, per person |
| Bone hoe | 4 wood, 6 stone | food tiles +10, per person |
| Iron axe | 6 wood, 6 iron | wood tiles +20, per person |
| Iron hoe | 4 wood, 6 iron | food tiles +20, per person |
| Iron pick | 6 wood, 5 iron | stone tiles +20, per person |

Jars and pack frames are one per party; tools can be made any number of times.

## Events

Several can fire in one turn; they queue and are shown one at a time. Every event
has at least one choice you can always take. The current events are placeholders
for the system; more are planned.

| Event | When it can happen | Choices |
| --- | --- | --- |
| Hard winter | from turn 12 (8%), or whenever wood is below 6 (25%) | burn 8 wood · or lose a person to the cold |
| Wanderers | camped, from turn 4 (12%) | take in 3 people for 6 food · or send them on |
| Spoiled stores | food above 30 (18%) | dry it over the fire (6 wood, lose 8% of food) · or throw out 30% of food |
| Idle talk | camped with 3+ idle people (20%) | hand out 8 food · or lose a person |
| Old cache | roaming, from turn 6 (12%, once) | take 8 wood, 6 food, 4 stone |

Rewards are capped by storage like everything else.

## Reading the map

```
      ╱╲
    ╱ ♣  ╲      terrain symbol — always a little above centre
   │  ◈   │     deposit: its symbol, ? if unsurveyed, a dot when zoomed out
    ╲ ▬  ╱      harvest progress (only on worked tiles)
      ╲╱
```

Work tiles with nobody on them have a faint outline — that is where you can send
people. Once someone is working a tile, **six bars** appear along its six edges,
one per slot, filled clockwise from the top right:

- **bright** — a person working there (**green** if they hold a tool)
- **dim** — an open slot you can still fill
- **dotted** — a slot that is not unlocked yet

Other marks:

- **Grey hexagon inset with three corner triangles** — a camp site of yours, with buildings waiting.
- **Pale blue `=`** — ice (winter only). **`≠`** — the ice is about to thaw.
- **Dimmed tiles** — explored, but not in sight right now.
- **Green shading** while roaming — where you can reach this turn.
- **`⌂`** — your camp. **Yellow dot** — your party while roaming.

## Controls

| | Desktop | Touch |
| --- | --- | --- |
| Move / send someone | click | tap |
| Recall someone | right-click, or **−** | **−** in the tile panel |
| Pan | drag | drag |
| Zoom | mouse wheel | pinch |
| Make / break camp | **C**, or the button | the button |
| End turn | **Space** / **Enter**, or the button | the button |
| Buildings and gear | **⌂ Camp** button (while camped) | **⌂ Camp** button |
| Season effects | hover the season | tap the season |

Breaking camp when it would throw goods away, and demolishing a building, both
ask for confirmation first. While a confirmation is open, keyboard shortcuts do
nothing.

## Saving

**Save** downloads the whole run as a small JSON file; **Load** reads one back.
Nothing is kept in the browser — the file is the save. Saves from before camp
sites existed still load: a store, workshop or watchtower you had is placed as a
building where your party stands.
