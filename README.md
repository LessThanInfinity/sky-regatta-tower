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
  - **The roll fills in the VP, you have the last word (default).** A player's roll puts its VP (for example +2) in that rider's stepper, so you can't forget it, and you can change it before you roll the section. Whatever you typed is kept when another player rolls. The world setting *Player rolls fill in the VP* turns this off: the roll then only *suggests* VP, with a **use +2 VP** link.
  - **Everything else is still tracked for you:** Favor, drake rungs, the skill used (no repeats), and rival VP queued for NPCs. **Clear roll** takes a roll back so someone can roll again.
- **Battle:** Bump, Cut off, Distract and Draft take 1 VP from the target when they land (queued as an NPC adjustment). Hold the line cancels one NPC attack on that PC (a crit also bumps the attacker). NPC hits on a PC now subtract the VP automatically.
- **The Narrows (lap 2):** three checks with three different skills, strikes and shelter handled for you.
- **Hero Points:** after a rider has rolled, **Roll my check** reopens as a read-only view of the roll (what was picked, the d20, the degree and the suggested VP). If the PF2e actor has a Hero Point, a **Spend a Hero Point to reroll** button appears there. It rerolls the d20 and keeps the new result, undoes what the old roll did (Favor, drake, rival VP) and applies the new one, and takes the point off the actor. One reroll per roll. In the Narrows (three checks) the player picks which one of the three dice to reroll.
- **Section numbers:** the window subtitle shows the section being played now (for example *Section 5/16 · A, Entry*, under *LAP 2/4*), and the GM report says which section it covers.
- **The bench (Reta and Rowan):** the two party members who aren't riding get their own **Bench action** button (in the tower and on the DC card). Each takes one action per section and rolls with their own PF2e skill plus the party's +2. The GM sees the result in a whisper and the tower shows it. Help has to come before the rider rolls (except the pit stop).
  - **Spotter** (Perception DC 28, sections A, B and D): +1 circumstance on a rider's roll this section, +2 on a crit.
  - **Pit crew** (Nature, Medicine or Crafting DC 30): the rider boxes and pays 1 VP (already in their stepper). Success: the drake climbs a rung, a crit two (up to Surging), a crit failure drops a rung. Once per rider per lap.
  - **Fix it** (Nature or Diplomacy DC 30): the rider's drake penalty is ignored this section and one Narrows strike is cancelled; a crit also gives back their last used skill for this lap.
  - **In Battle** (the bench is on the ground, so it can only watch and shout; Spotter and Fix it don't apply there): **Call the attack** (Perception DC 28, cancels one NPC attack on their rider, a crit also gives 1 Favor; one cancel per attack, so it doesn't stack with Hold the line) and **Work the crowd** (Performance DC 28, +1 party Favor, +2 on a crit, no VP). Pit crew works in Battle too. Act any time before the GM rolls the section.
  - **Extra (off by default, setting *Extra bench actions*):** **Scout** (Society or Survival DC 28, the GM tells them the best lane or line, a crit gives +1 circumstance).
  - The GM can **clear** a bench action from the controls.
- **NPC benches:** each NPC rider's team has a bench too. Each lap there is a chance (world setting *NPC bench strength*, default 0.2) that the NPC's lap roll gets +1; the GM report notes it. In simulations this leaves the party at roughly 27 percent if they only spot and about 40 percent if they go All-out and use pit stops.
- **Surging:** the drake ladder now has one rung above Fresh. A Surging drake gives +1 circumstance (it doesn't stack with bench help) and lasts until the end of the lap. A pit crit or a crit on Command the drake gets there.
- **Burn the drake (off by default, setting *Allow Burn the drake*):** a rider with a Fresh or Surging drake can take +2 on a roll and drop the drake a rung (not in the Narrows).
- **GM tweaks:** drake rung and party Favor steppers for pit actions and rulings.

## Crit cut-ins (v0.4.11)

With the **Cinematic Cut-ins** module installed, a rider's critical success (a PC check that is a crit after the natural 20 or 1 shift, including any one check in the Narrows and a Hero Point reroll) plays that actor's own cut-in for everyone. Cinematic Cut-ins can't catch these itself: it only reacts to PF2e's own attack-roll messages, and the tower posts its own cards. The actor needs a cut-in set up (the module's active configuration). The world setting *Play the crit cut-in on a critical success* turns it off.

## Race view (v2.0)

A portrait, top-down window docked on the right of the standings tower. The eight drakes fly down it in the order of the tower, so nobody has to drag tokens around the map.

- **Positions:** the leader is at the top. The vertical spacing is half even-by-rank and half the real VP gap, so the top three, the middle two and the last three always keep to their thirds of the view, and a runaway leader still looks like one. A very wide field also shrinks the drakes a little. Drakes that would overlap fly in different lanes.
- **Motion:** each drake is a layered cutout (two wings, tail, body, head). The wings fold and flap, the tail sways and the drake banks into a move. The land, clouds and rocks scroll past at different speeds for depth, each drake casts a shadow, and the wingtips leave streaks. A drake that gains places beats its wings harder and swerves around the rocks. The rocks are decoration.
- **Tokens:** each rider's token image sits on their drake in a ring of their team color (letters if the actor has no image).
- **Updates by itself:** it reads the same standings as the tower and moves when a section is resolved, undone or reset. It never changes the race.
- **Settings:** *Show the race view* (per player, on a small screen turn it off; the window shrinks back to the tower), *Animate the race view* (off: the drakes jump to their places and nothing scrolls; also off with the system's reduced-motion setting) and *Actor tokens on the drakes* (world).
- **Files:** `scripts/racelayout.mjs` (positions, unit tested), `scripts/wyvern.mjs` (the artwork as SVG), `scripts/viz.mjs` (the animation), `styles/regatta-viz-2.0.0.css`. `preview/viz.html` runs the real view in a browser with buttons to roll, tie and spread the field.

## Roll visibility, VP fixes, replay and redo (v2.1)

- **Roll visibility:** every roll the module makes follows the roller's own chat roll mode (Public Roll, Private GM Roll, Blind GM Roll, Self Roll, the dropdown in the chat box). A player's roll runs on the GM's computer, so the player's mode is sent along with the request. A player's roll is public unless they pick another mode; the NPC d20s and your own rolls follow your mode (the world setting *Show the NPC d20s to players*, when on, always makes them public). The GM report in chat stays GM only.
- **Fix a total any time (GM):** each VP total on the board is a box. Click it, type the new total, press Enter (Escape cancels). The race view and the standings update, and a GM-only chat line records the change. The same is available as `api.setVp(id, value)` or the command action `setVp` with `input: { id, value }`.
- **Undo, Replay, Redo roll (GM):**
  - **Undo** takes back the last section, as before.
  - **Replay undone section** (appears after an undo) undoes the undo: it brings back the section you just undid, exactly as it was. You can undo several sections and replay them newest first. Anything you changed since the undo (steppers, a typed total) is lost when you replay.
  - **Redo roll (same dice)** (also appears after an undo) runs the section again with the same dice for the NPCs, the lap rolls, who attacks whom, and the bench roll, and with the values currently in the steppers. Use it when you forgot a modifier. The normal **Roll next section** still rolls fresh dice.
  - Rolling a new section, or Reset, ends the chance to replay.
  - Commands: `replay` and `redo` (with the same `input` as `roll`) on the `command` setting; `api.replay()` and `api.redoRoll(input)`.

## Bench visuals and skill picker (v2.2)

- **Spotter aura:** the helped drake's outline lights up. Success flashes green then pulses; a crit pulses brighter and faster; a crit failure flashes red then glows dim red. It clears when that rider rolls.
- **Bench skill picker:** actions with several skills (Pit crew, Fix it) tick the member's best skill by default, in a clearer "Pick the skill to roll" panel, and the bench dialog has more breathing room.

## Install

In Foundry: Add-on Modules, Install Module, paste the manifest URL:

`https://raw.githubusercontent.com/LessThanInfinity/sky-regatta-tower/main/module.json`

Then enable the module in the world.

## Use

- **Show to players:** the button in the GM controls opens the standings on every connected client (also available as `api.show()`, or action `show` on the command setting). Without it, players get the window automatically after the first roll.
- Open the window on your own screen with the macro `game.modules.get("sky-regatta-tower").api.open()`.
- GM only: `api.rollNext({ violet: 5, aji: 4 })`, `api.undo()`, `api.reset()`.
- **Remote control (for the MCP or another macro):** write `{ "id": "<anything unique>", "action": "roll" | "undo" | "replay" | "redo" | "setVp" | "reset" | "open", "input": { "violet": 5, "aji": 4 } }` to the module's `command` world setting. The active GM's browser tab acts on it. PC totals default to the saved ones if you leave them out.
- The race state is the module's `state` world setting.

## Develop

```bash
npm test                       # rules engine tests
python -m http.server 8765     # then open http://localhost:8765/preview/index.html (tower) or /preview/viz.html (race view)
```

The preview page renders the real template, CSS and engine with Foundry's window chrome faked.

## Release

Zip `module.json`, `scripts/`, `styles/` and `templates/` (with `module.json` at the root of the zip), attach it to a GitHub release named `v<version>`, and keep the `download` URL in `module.json` in sync.
