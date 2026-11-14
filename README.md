# Sky Regatta Standings

An F1-style timing tower for the Sky Regatta race (Foundry VTT v13).

- **Everyone** sees the standings: position, team tag, victory points (VP), the VP gained in the last section, and the gap to the leader in grid squares (capped at 6).
- **The GM** also gets a control bar: enter the PCs' VP totals, then **Roll next section** to resolve all six NPC riders (rating dice, Narrows, Battle attacks and drafts). **Undo** and **Reset** are there too.
- Green and red carets show places gained or lost in the last section, with a matching green or red underline on the row.
- The PC inputs have + and - buttons and stay inside what one section allows (for example up to +4 for a line roll, +6 for the Narrows). Tick *Unlock limits* to override.
- A whispered chat message lists what each NPC did, so you can move tokens.
- Rows slide up and down when riders change position (about 0.7 seconds; each player can turn it off in module settings, and it respects the browser's reduce-motion setting).
- The window opens by itself on every player's screen when you resolve a section (a client setting turns that off).

The rules live in `scripts/engine.mjs` (pure JavaScript, unit tested). The riders, ratings, personalities and team colors are in the `ROSTER` list at the top of that file.

## Install

In Foundry: Add-on Modules, Install Module, paste the manifest URL:

`https://raw.githubusercontent.com/LessThanInfinity/sky-regatta-tower/main/module.json`

Then enable the module in the world.

## Use

- **Show to players:** the button in the GM controls opens the standings on every connected client (also available as `api.show()`, or action `show` on the command setting). Without it, players get the window automatically after the first roll.
- Open the window on your own screen with the macro `game.modules.get("sky-regatta-tower").api.open()`.
- GM only: `api.rollNext({ violet: 5, aji: 4 })`, `api.undo()`, `api.reset()`.
- **Remote control (for the MCP or another macro):** write `{ "id": "<anything unique>", "action": "roll" | "undo" | "reset" | "open", "input": { "violet": 5, "aji": 4 } }` to the module's `command` world setting. The active GM's browser tab acts on it. PC totals default to the saved ones if you leave them out.
- The race state is the module's `state` world setting.

## Develop

```bash
npm test                       # rules engine tests
python -m http.server 8765     # then open http://localhost:8765/preview/index.html
```

The preview page renders the real template, CSS and engine with Foundry's window chrome faked.

## Release

Zip `module.json`, `scripts/`, `styles/` and `templates/` (with `module.json` at the root of the zip), attach it to a GitHub release named `v<version>`, and keep the `download` URL in `module.json` in sync.
