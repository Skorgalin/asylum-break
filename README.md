# Asylum Break

A browser-based 3D multiplayer prototype inspired by a prison-asylum escape game.

## Features
- 3D scene with multiple floor levels
- Role selection: Patient, Medic, Orderly, Director
- Per-role spawn locations
- Keycard and Director-only door behavior
- Multiplayer support through Socket.IO
- Browser playable on desktop and mobile Safari

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
   npm install
   ```
4. Set the start command to:
   ```bash
   npm start
   ```
5. Deploy. Your site will be live with the game client and Socket.IO multiplayer server.

## Current prototype notes
- This is a playable foundation, not a full game balance pass.
- Doors are visualized in the scene and the role logic hooks are in place.
- You can expand specific mechanics like arresting players, stun states, and true keycard locks later.
