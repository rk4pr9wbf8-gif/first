# Alcan Autumn

An endless procedural driving game through fall colour, from the Cascade Range to the mountains of Alaska. It runs in the browser with Three.js and has no build step and no asset downloads: every texture, tree, mountain and sound is generated in code.

## Run it

ES modules need to be served over HTTP, so opening `index.html` straight from disk won't work. From the repo root:

```sh
python3 -m http.server 8000
# or: npx serve .
```

Then open http://localhost:8000. Three.js 0.160 and the fonts load from public CDNs.

Add `?q=0` … `?q=3` to the URL to force Low / Medium / High / Ultra quality. Otherwise the game picks High on desktop and Low on touch devices, and drops a level by itself if the first seconds of driving run below about 32 fps.

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Accelerate |
| S / ↓ | Brake, then reverse |
| A D / ← → | Steer |
| Space | Handbrake (drift) |
| C | Camera: chase, far chase, bumper, roadside TV camera, drone |
| Mouse drag / wheel | Look around / zoom |
| O | Scenic autopilot (steer or brake to take over) |
| T | Time of day: morning mist, midday, golden hour, dusk, night |
| H | Headlights (they switch on automatically at night and in tunnels) |
| R | Put the car back on the road |
| P | Paint colour |
| U | km/h ↔ mph |
| Q | Graphics quality |
| M | Mute |
| ? | Show all controls |

A gamepad also works: left stick steers, triggers are throttle and brake, A/B is the handbrake, Y changes camera and X changes the time of day. On phones you get on-screen pedals plus CAM, TIME and AUTO buttons.

## What's in the world

- **Terrain** (`src/world.js`, `src/terrain.js`): domain-warped ridged multifractal ranges and broad glacial valleys. Stratovolcanoes up to about 3 km high are scattered on a 15 km grid, so peaks like Rainier or Hood stand on the horizon. A slowly varying biome field blends the Cascadia look (Douglas fir, vine and bigleaf maple, higher snowline) into the Alaska look (spruce, paper birch, red tundra, fjords below sea level, a snowline near 1,000 m). Terrain streams as a quadtree with 32×32 leaves, from 2 m spacing at the car out to 256 m spacing about 15 km away, and skirts hide the cracks between levels.
- **Road** (`src/road.js`): the centreline grows 4 m at a time. A "surveyor" tries nine headings, looks up to about 390 m ahead and prefers gentle grades, dry land and its general heading, and keeps away from earlier parts of the road. The vertical profile is smoothed and limited to a 12% grade. Where the hillside is more than 24 m above the road it bores a **tunnel**; where the ground falls more than 15 m below, or there is water, it builds a **bridge**. Morphological filtering removes slivers. The terrain is then carved to the road, with rough rock cuts and fills.
- **Structures** (`src/roadmesh.js`): asphalt with a double yellow centre line and fog lines, gravel shoulders, W-beam guard rails where the ground drops away, delineator posts, viaducts with piers and parapets, and tunnels with sodium lamps and concrete portal collars that hug the hillside.
- **Forest** (`src/vegetation.js`): instanced conifers, maples, birches, shrubs, boulders and grass tufts, placed in 256 m cells with two levels of detail. Maple, birch and shrub colours come from patchy "peak colour" noise, so you pass stands of crimson and stands of gold. Foliage sways in the wind, glows when the sun is behind it, and has ragged edges. Beyond the tree radius the terrain shader paints a matching canopy, so whole hillsides read as forest.
- **Atmosphere** (`src/atmosphere.js`, `src/effects.js`): physical sky with an October sun path, drifting clouds, stars, image-based lighting, exponential fog, reflective fjord water, and falling leaves that swirl around the camera.
- **Car** (`src/car.js`): a modelled wagon with clear-coat paint and working lights, driven by a bicycle-model tyre simulation. It has slip angles, load transfer, a handbrake for drifts, gentle stability control, slope gravity, and collisions with tunnel walls, parapets, guard rails, trees and boulders. The engine, tyre and wind sounds are synthesised with Web Audio, and tunnels add an echo.
- **HUD**: highway-sign style region names ("Entering Turnagain Arm"), a yellow tunnel warning sign showing the tunnel's length, a heading-up minimap, speed, gear, distance, elevation and time of day.
