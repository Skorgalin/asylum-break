# Asylum Break

A browser-based 3D multiplayer prototype inspired by a prison-asylum escape game.

## Features
- 3D building with three furnished floors: ground floor (lobby, security, cafeteria, gym), medical floor (infirmary, surgery, research lab, offices) and the patient ward (28 cells, day room, dorm, showers, isolation)
- First-person and third-person camera: V, the mouse wheel or the 1ST/3RD button on touch screens
- Role selection: Patient, Medic, Orderly, Director
- Per-role spawn locations
- Walkable staircases between floors, placed in random rooms each time the server starts; jump with Space (JUMP on touch) and simple collision with beds, lab walls and tables
- Director tablet with camera views (equip the tablet, slot 4)
- Items and combat: melee weapons, throwables, a taser, shields, arrests, med kits and drinks (see below)
- Multiplayer support through Socket.IO
- Browser playable on desktop and mobile Safari

## Items
All item stats live in `public/items.js`, which both the server and the browser load. Change a number there and restart the server.

- **Use:** click (without dragging) or Space on desktop, the red USE button on touch screens. Pick an item with 1–6 or by tapping its slot; picking it again puts it away.
- **Vending machines:** items no longer lie around. 24 machines stand against the walls on every floor (`VENDING` in `layout.js`), each stocked from a loot pool. Press E in front of one and take what you need (max 6 slots). They are free for now (`VENDING_PRICE` in `server.js`); goods that sell for credits are left out.
- **Status:** stunned players cannot move or use items, slowed players are slower, at 0 health a player is knocked out and respawns after 5 s with their starting loadout.
- **Arrest:** staff can cuff a stunned or knocked-out patient, who goes back to the ward and is held for 8 s.
- **78 items** in four pools (`patient`, `staff`, `medical`, `common` in `LOOT` in `layout.js`) that stock the vending machines. Besides weapons, throwables and med kits there are:
  - **Rays** that stun, damage, slow, net (can't walk, can still fight), blind or pull the target in.
  - **Pulses** around yourself (proximity taser, scream, rally flag), **shove** and **shoulder charge**.
  - **Zones:** fire, gas (hurts and slows; a gas mask protects), healing mist, and a signal jammer that switches off enemy items marked `electric` (tasers, launchers, the tablet's cameras).
  - **Sticky bombs** that latch on to the nearest enemy, **berserk** drugs (more damage), a **combat vest** (less damage) and a **gas mask**, both worn until you are knocked out.
  - **Disguises** as medic, orderly or director, or **hiding** as a cardboard box or a potted shrub (slow; using an item gives you away).
  - **Straitjacket** (keeps a stunned patient in place) and **Fireman's Carry** (pick up a stunned player, use again to put them down).
  - Items with `roles` are limited to those roles, e.g. the Medi Gun is medic-only.
- **Patients vs patients:** weapons hit other patients too (never the thrower); healing and the rally flag still work between patients.

## Facility systems
- **Stamina:** sprinting drains it, food refills it; run dry and you walk until it is back to 30.
- **E to interact** (or the E button on touch screens), all defined in `STATIONS` in `layout.js`:
  - **Jobs:** bring laundry to a washing machine or a paintbrush to a canvas and stand still to earn credits and XP.
  - **Shops:** the commissary (patients) and the supply terminal (staff) sell everything with a `price` in `items.js`; the commissary also buys contraband.
  - **Escape:** patients with a stolen keycard, or a crowbar, fire axe or rebar hammer to pry it open, leave through the main exit for a big reward.
  - **Breaker panel** in Electrical: patients cut the power (lights out for a minute, staff alerted), staff switch it back on. Flashlights and night vision goggles help in the dark.
- **Credits and XP** stay with you when you respawn. Arrests pay staff and seize any contraband.
- **Security doors** (`SECURE_DOORS`) into staff rooms: staff and patients with a stolen keycard pass; patients can batter or blow them open; staff weld them shut against keycards or repair them with a welding torch. Knocked-out staff sometimes drop their keycard.
- **Chat:** Enter or T, Tab switches between your team and everyone. Staff talk over the radio, which a patient with a stolen radio can hear, alarms included.
- **Vehicles** (`VEHICLES`): wheelchairs for anyone (one pushes, one rides), golf carts and a forklift for staff that run enemies over. They stay on their floor.
- **Devices:** the orderly's combat drone follows and stuns, the recon drone and the director's hostile detector mark patients through walls, the medic's therapy turret heals staff. Patients can smash them.
- **Staircases** are placed at random, but only where they cut nothing off: a walkability check keeps every doorway, spawn and station (vending machines included) reachable and the corridors clear.
- The server decides every hit; the browser only shows what happened.

## Building
The floor plan lives in `public/layout.js`, which both the server and the browser load: walls and doors, rooms, furniture positions, spawns, vending machines and the director's security cameras. `public/interior.js` turns it into meshes (merged per material, so a floor is a few dozen draw calls). The server uses the same walls to stop players walking through them and to block hits, blasts and throws behind walls.

## Characters
The four role models live in `public/assets/characters/*.glb` (about 0.2–0.5 MB each). They are built with Blender from the source STL sculpts by the scripts in `tools/character-pipeline`:

1. `prepare.py` imports an STL and decimates it (the sources are ~2 million triangles).
2. `build.py` cuts the T-pose figure into head, torso, arms and legs with their joints as pivots, drops everything that is not body (held items, the drone, the patient's aura), paints the colours from the role artwork and exports a GLB. Colours and body measurements per role are at the top of the script.
3. The face comes from the full-resolution STL, not the decimated mesh (`face_map.py`, called by `build.py`): it is read from the front into a texture with clean line art, and the decimated face is flattened underneath it. Per role, `FACE` in `build.py` sets the start point, the face width and the fills (eye whites, irises, pupils, mouths).

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --python tools/character-pipeline/prepare.py -- "source.stl" out/patient
/Applications/Blender.app/Contents/MacOS/Blender -b --python tools/character-pipeline/build.py -- out/patient.blend patient public/assets/characters/patient.glb "source.stl"
```

`public/characters.js` loads the models and builds the posable rig; the walk, attack, stunned and knocked-out poses are animated in `animateActor` in `game.js`. `character-preview.html` shows all four side by side (`?spin=1` rotates them, `?head=medic` shows one face up close). Until a model has loaded, the old blocky figure stands in. The STL sources are not committed (`*.stl` is ignored).

## Run locally
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   npm start
   ```
3. Open `http://localhost:3000` in the browser.

## Render deployment
1. Push this repo to GitHub.
2. Create a new Render Web Service pointing to this repo.
3. Set the build command to:
   ```bash
   npm ci
   ```
4. Set the start command to:
   ```bash
   npm start
   ```
5. Optional: set the health check path to `/health`.
6. Deploy. Your site will be live with the game client and Socket.IO multiplayer server.

Note: on Render's free plan the service sleeps when idle (first visit takes ~30 s) and all game state lives in memory, so it resets on every restart or deploy.

## Current prototype notes
- This is a playable foundation, not a full game balance pass.
- The server validates movement (no teleporting, floor changes only at stairwells), limits the game to one Director and rate-limits events.
- Players who briefly lose connection get their position back for 60 seconds.
- `map.html` is a separate map concept page, not part of the playable game.
