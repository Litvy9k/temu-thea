# temu-thea — player's manual

How the game works, from the player's side. Every number here is the live value
in the code; if they ever disagree, the code is right and this file is stale.

Technical details and the to-do list are in [DEVELOPMENT.md](DEVELOPMENT.md).

## The idea

You lead a small band of people across a big unexplored map. You can either
**roam** (move, but nobody works) or **camp** (work the land around you, but
stay put). Keep everyone fed and warm, grow the party, build up gear — and move
on when the land around you has nothing more to give.

There is no win condition yet. The run ends when everyone is gone.

## A turn

You move or assign work, then press **End turn**. At the end of each turn, in
this order:

1. Every worked tile advances its harvest bar, and full bars pay out.
2. Upkeep is paid: food for every person, wood for the fire.
3. Anything above the storage cap is thrown away.
4. If food or wood ran short, **one person dies**.
5. Every 10th turn, if nobody went short this turn, **one person joins**.
6. Events roll, and any that fire are shown one at a time before the next turn.

## Roaming and camping

The two are mutually exclusive.

| | Roaming | Camped |
| --- | --- | --- |
| Move | 4 moves per turn (5 with pack frames) | no |
| Work the land | no | yes, the six tiles around the camp |
| Build and craft | no | yes |
| Upkeep | paid in full | paid in full |

**Making camp** needs at least one move left this turn, so you cannot walk your
full distance and start working on the same turn. **Breaking camp** uses up the
rest of the turn's moves. Relocating therefore always costs at least one turn in
which nobody works.

Facilities and tools are packed up and come with you when you break camp.

## Gathering

When camped, the six tiles around the camp are your **work tiles**. Click (tap) a
work tile to send one idle person there; use **−** / **+** in the tile panel to
adjust, or right-click to recall on desktop.

- Every tile has a **harvest bar** that fills to 40.
- Each person pushes it **20 per turn**, so one person completes a harvest every
  two turns.
- A full bar pays out the tile's yield. Progress **overflows**: 50 is one harvest
  with 10 carried over.
- Each tile holds **at most 2 people** for now. Six is the eventual ceiling, one
  per edge of the hexagon; facilities to raise the limit are planned.
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
| Food | 1 per person per turn | the store saves 1 per turn in total |
| Wood | 1 per turn | flat — the fire burns the same for 3 people or 30, roaming or camped |

Running short of either costs one person that turn. A turn without shortage on a
multiple of 10 brings one new person.

## Storage

Every resource is capped at **40**. The store adds 40, clay jars add another 40.
Anything gathered past the cap is thrown away, and the resource bar shows how
much in red — a full barrel is a prompt to spend, move or expand.

## Terrain

| Terrain | Move cost | Yield per harvest | Sight |
| --- | --- | --- | --- |
| Grassland `·` | 1 | 4 food | 2 |
| Forest `♣` | 2 | 5 wood, 1 food | 1 |
| Hills `∩` | 2 | 4 stone, 1 food | 3 |
| Marsh `"` | 3 | 2 food, 2 wood | 1 |
| Tundra `,` | 1 | 2 food | 3 |
| Desert `˙` | 1 | nothing | 3 |
| Shallows `~` | impassable | 6 food | — |
| Mountains `▲` | impassable | 6 stone | — |
| Ocean `≈` | impassable | nothing | — |

Shallows and mountains cannot be entered, but you can work them from a camp next
to them. Sight is how far you see standing there; a camp always sees 2 (3 with a
watchtower).

**No terrain is rich in both food and wood.** A good camp needs both nearby.

## Resources

| | | Comes from | Used for |
| --- | --- | --- | --- |
| Food | ✦ | grassland, shallows, tundra… | eating — every person, every turn |
| Wood | ❙ | forest, marsh | the fire, and most building |
| Stone | ◆ | hills, mountains | building and stone tools |
| Clay | ▱ | clay pits | clay jars |
| Hide | ◗ | game trails | pack frames |
| Iron | ◈ | iron veins | iron tools |

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
trails a bit further out, and iron further still. Pushing outward is how you find
the good ground.

### Surveying

Seeing a deposit from a distance only tells you *something is there* — it shows
as a **`?`**. To find out what it is, walk next to it: any tile within your work
reach (1 tile) is **surveyed**, whether you are roaming past or camped. Once
surveyed, a tile stays surveyed.

You can never assign people to an unsurveyed tile, because every tile you can
work is next to you.

## Facilities

One of each. Building needs a camp. They travel with you.

| Facility | Cost | Effect |
| --- | --- | --- |
| Store | 12 wood, 6 stone | storage +40, food upkeep −1 |
| Workshop | 14 wood, 10 stone | unlocks crafting |
| Watchtower | 10 wood, 8 stone | camp sight +1 |
| Clay jars | 6 wood, 12 clay | storage +40 |
| Pack frames | 6 wood, 10 hide | moves +1 while roaming |

## Tools

Crafting needs a workshop and a camp.

| Tool | Cost | Helps on | Bonus |
| --- | --- | --- | --- |
| Stone axe | 6 wood, 4 stone | wood tiles | +10 |
| Bone hoe | 4 wood, 6 stone | food tiles | +10 |
| Iron axe | 6 wood, 6 iron | wood tiles | +20 |
| Iron hoe | 4 wood, 6 iron | food tiles | +20 |
| Iron pick | 6 wood, 5 iron | stone tiles | +20 |

## Events

Several can fire in one turn; they queue and are shown one at a time. Every event
has at least one choice you can always take.

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

Work tiles with nobody on them just have a faint outline — that is where you can
send people. Once someone is working a tile, **six bars** appear along its six
edges, one per slot, filled clockwise from the top right:

- **bright** — a person working there (**green** if they hold a tool)
- **dim** — an open slot you can still fill
- **dotted** — a slot that is not unlocked yet

Other marks:

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
| Facilities and crafting | **⌂ Camp** button (while camped) | **⌂ Camp** button |

## Saving

**Save** downloads the whole run as a small JSON file; **Load** reads one back.
Nothing is kept in the browser — the file is the save.
