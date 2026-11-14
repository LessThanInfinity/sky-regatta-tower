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

## Dice, DCs and player rolls (v0.4)

- **NPC d20s:** when you press **Roll next section**, the module also rolls a real d20 for each NPC rider against a DC, using their PF2e skill modifiers (looked up on the actor by name, with the roster numbers as a fallback). Personality sets the line (aggressive: All-out, cautious: Hold pace). It is theatre: the d6 table still decides their VP. The rolls go in one public chat message, so Dice So Nice animates them for everyone. Two world settings: roll them at all, and show them to players or only the GM.
- **Post DCs to chat:** the GM button posts the current section's DCs, with a **Roll my check** button.
- **Roll my check:** opens a picker (also a button at the bottom of the tower). Players pick a line and an approach; every choice says what it does. Skills already used this lap are struck through and disabled (the no-repeat rule), and shown under the standings for everyone. The roll is made on the GM's client over the module socket, so the GM must be connected.
- **Modifiers:** the actor's skill, the party's +2, drake condition (Winded -1, Strained -2), bench help (+1 or +2 circumstance, the best one counts, a carried +1 from Hold the line included), and optionally 1 Favor for +1 (max 2 a lap).
- **Results:** the degree of success is the PF2e one (beat by 10 for a crit, miss by 10 for a crit failure, natural 20 and 1 move it a step).
  - **You set the VP (default).** A player's roll shows the degree and *suggests* VP ("Suggested: +3 VP"), but your steppers stay where you put them, so you decide what a crit is worth. A **use +3 VP** link copies the suggestion into the stepper. Whatever you typed is kept when a player rolls (it is only reset when the section changes). The world setting *Player rolls set VP automatically* turns auto-fill back on.
  - **Everything else is still tracked for you:** Favor, Influence, drake rungs, the skill used (no repeats), and rival VP queued for NPCs. **Clear roll** takes a roll back so someone can roll again.
- **Battle:** Bump, Cut off, Distract and Draft take 1 VP from the target when they land (queued as an NPC adjustment). Hold the line cancels one NPC attack on that PC (a crit also bumps the attacker). NPC hits on a PC now subtract the VP automatically.
- **The Narrows (lap 2):** three checks with three different skills, strikes and shelter handled for you.
- **GM tweaks:** drake rung and party Favor steppers for pit actions and rulings.

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
