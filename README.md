# Alcan Autumn

An endless procedural driving game through fall colour, from the Cascade Range to the mountains of Alaska. It runs in the browser with Three.js and has no build step. The world itself (every texture, tree, mountain and sound) is generated in code; the only asset is the car model in `assets/car.glb`.

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
| C | Camera: chase, far chase, cockpit, bumper, roadside TV camera, drone |
| G | Garage: upgrades, tuning and customisation |
| N | Nitrous (when fitted) |
| E / Z | Shift up / down (manual gearbox, set in the garage) |
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

## Garage

Press **G** (or the Garage button) to open a showroom with the car on a turntable. Drag to orbit, scroll to zoom, and hold **Rev** to hear the engine. Every change is saved in your browser and applies on the road straight away.

- **Upgrades** (`src/spec.js`): about 30 part slots with real-world part names and prices, across engine (intake, exhaust, headers, cams, valvetrain, forged internals, 4.9 L stroker, flywheel, ECU stages, fuel system), forced induction (centrifugal or twin-screw supercharger, two twin-turbo kits, intercooler, blow-off valve, three nitrous kits), drivetrain (clutch, close-ratio or sequential gearbox, LSDs, carbon half-shafts), chassis (five suspension types, anti-roll bars, bracing or a roll cage, weight reduction, carbon panels), brakes, five tire compounds and widths, and aero (lip, splitter, canards, ducktail, GT, swan-neck and time-attack wings, diffuser, skirts). Each option previews its change in horsepower, weight and PI.
- **Tuning**: tire pressures, camber and toe, springs, ride height, bump and rebound damping, anti-roll bars, final drive and individual gear ratios, wing and splitter angles, brake balance and pressure, differential lock on acceleration and deceleration, boost, shift limiter and steering lock. Each setting unlocks only when the part that makes it adjustable is fitted, as in Forza.
- **Stats**: a straight-line simulation using the same drivetrain model as the car gives power, torque, weight, 0–100 and 0–200 km/h, quarter mile, top speed, 100–0 braking distance, lateral grip, rating bars, a PI score with a class letter (D to X) and a dyno chart against stock. Stock comes out at 3.4 s to 100 km/h and an 11.0 s quarter mile, close to the real car.
- **Style** (`src/carparts.js`): paint from 16 factory colours or any custom colour, in gloss, metallic, pearl, satin, matte or chrome finishes; twin, centre, side or two-tone stripes; window tint; nine wheel designs with colour, finish, size and caliper colour; body kit parts fitted to the body by ray casting; carbon widebody flares; wheel spacers and stance camber; headlight colour temperature, smoked tails and underglow; and in the interior, leather or carbon race buckets, 6-point harnesses, leather, accent and carpet colours and carbon or leather trim.
- **Assists**: ABS, traction control (full, sport or off), stability control, and automatic or manual gearbox.

## Driving model

The car has a real drivetrain: a torque curve modelled on the F136 V8, gear ratios and final drive, clutch slip at launch, turbo spool, a rev limiter, wheelspin, downforce and drag, brake balance with lockup when ABS is off, a friction circle per axle, and differential behaviour.

## Sound

- **Engine** (`src/engine-worklet.js`): an AudioWorklet synthesises the V8 firing by firing. Pulses pass through resonators that track the firing order and through fixed exhaust formants. It includes per-cylinder variation, idle lope from race cams, limiter bounce and overrun crackle. Exhaust and intake upgrades change the character.
- **Car sounds** (`src/audio.js`): turbo whistle and blow-off flutter, supercharger whine, straight-cut gear whine, shift clunks, tire squeal, tarmac and gravel road noise, wind, nitrous hiss, impacts, and convolution reverb in tunnels.
- **Nature** (`src/nature.js`): wind gusts in the trees, rustling leaves, a creek when you're near water, and birds chosen by region and time of day: varied thrush, chickadee, Pacific wren, Steller's jay, raven, woodpecker and bald eagle by day, a barred owl and (in Alaska) distant wolves at night. The ambience fades as you speed up and goes quiet in tunnels.

## What's in the world

- **Terrain** (`src/world.js`, `src/terrain.js`): domain-warped ridged multifractal ranges and broad glacial valleys. Stratovolcanoes up to about 3 km high are scattered on a 15 km grid, so peaks like Rainier or Hood stand on the horizon. A slowly varying biome field blends the Cascadia look (Douglas fir, vine and bigleaf maple, higher snowline) into the Alaska look (spruce, paper birch, red tundra, fjords below sea level, a snowline near 1,000 m). Terrain streams as a quadtree with 32×32 leaves, from 2 m spacing at the car out to 256 m spacing about 15 km away, and skirts hide the cracks between levels.
- **Road** (`src/road.js`): the centreline grows 4 m at a time. A "surveyor" tries nine headings, looks up to about 390 m ahead and prefers gentle grades, dry land and its general heading, and keeps away from earlier parts of the road. The vertical profile is smoothed and limited to a 12% grade. Where the hillside is more than 24 m above the road it bores a **tunnel**; where the ground falls more than 15 m below, or there is water, it builds a **bridge**. Morphological filtering removes slivers. The terrain is then carved to the road, with rough rock cuts and fills.
- **Structures** (`src/roadmesh.js`): asphalt with a double yellow centre line and fog lines, gravel shoulders, W-beam guard rails where the ground drops away, delineator posts, viaducts with piers and parapets, and tunnels with sodium lamps and concrete portal collars that hug the hillside.
- **Forest** (`src/vegetation.js`): instanced conifers, maples, birches, shrubs, textured boulders and grass tufts. Crowns are built from alpha-tested cards painted with maple leaves, birch leaves and needle sprays, lit with soft spherical normals, placed in 256 m cells with two levels of detail. Maple, birch and shrub colours come from patchy "peak colour" noise, so you pass stands of crimson and stands of gold. Foliage sways in the wind, glows when the sun is behind it, and has ragged edges. Beyond the tree radius the terrain shader paints a matching canopy, so whole hillsides read as forest.
- **Lighting** (`src/realism.js`): every lit surface marches a ray toward the sun through a 16 km heightfield, so mountains cast shadows across whole valleys far beyond the shadow map's reach. The same heightfield darkens valley floors and gorges (large-scale ambient occlusion). Fog is height-based exponential haze with sun in-scattering, so valleys hold mist and the air glows toward the sun. Terrain, asphalt and concrete have detail normal maps. Ultra adds screen-space ambient occlusion (GTAO).
- **Atmosphere** (`src/atmosphere.js`, `src/effects.js`): physical sky with an October sun path, drifting clouds, stars, image-based lighting, exponential fog, reflective fjord water, and falling leaves that swirl around the camera.
- **Car** (`src/car.js`, `assets/car.glb`): a detailed supercar model (about 358k triangles) with clear-coat metallic paint, tinted glass, chrome, gunmetal rims, wheels that spin and steer, and working head, tail and brake lights. On High and Ultra it reflects the world around it through a live cube map, re-rendered one face per frame. It's driven by a bicycle-model tyre simulation. It has slip angles, load transfer, a handbrake for drifts, gentle stability control, slope gravity, and collisions with tunnel walls, parapets, guard rails, trees and boulders. The engine, tyre and wind sounds are synthesised with Web Audio, and tunnels add an echo.
- **HUD**: highway-sign style region names ("Entering Turnagain Arm"), a yellow tunnel warning sign showing the tunnel's length, a heading-up minimap, speed, gear, distance, elevation and time of day.

## Quality levels

| | Low | Medium | High | Ultra |
| --- | --- | --- | --- | --- |
| Shadow map | off | 1024 | 2048 | 4096 |
| Ray-marched terrain shadows and valley occlusion | off | on | on | on |
| Live car reflections | off | off | on | on |
| GTAO ambient occlusion | off | off | off | on |
| Finest terrain spacing | 4 m | 2 m | 2 m | 1 m |

## Credits

Car model: [Ferrari 458 Italia](https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6) by vicent091036, taken from the three.js examples. It was converted from Draco-compressed to quantized glTF so it loads without a WebAssembly decoder. Check the model's licence on Sketchfab before using it outside personal projects.
