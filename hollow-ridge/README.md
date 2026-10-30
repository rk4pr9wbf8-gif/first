# Hollow Ridge

A calm 3D wander through the Appalachian ridges in late October: smooth eroded mountains, a creek that runs down the valleys into a lake, fall forests, a homestead with farm animals, wildlife, building, a day–night cycle, synthesized ambient sound, and an optional dream mode.

## Play

Download `HollowRidge.zip`, unzip it, and double-click the launcher for your system (`Play Hollow Ridge (Windows).bat`, `Play Hollow Ridge (Mac).command`, or `play-linux.sh`). You can also open `index.html` directly in Chrome, Edge, Brave or Firefox. It runs offline.

## Build

```
npm install
npm run build
```

This bundles `src/` into one self-contained `dist/HollowRidge/index.html`, writes the launchers and README, and zips them into `dist/HollowRidge.zip`. `dist/artifact.html` is the same game without the document wrapper, for hosting as a web page.

## Layout

- `src/world.js` terrain generation, the river, lake and river water
- `src/sky.js` sky, sun and moon, time of day
- `src/flora.js` trees, undergrowth, falling leaves, motes, mist
- `src/fauna.js` animals: models, GPU animation, behaviour, petting
- `src/build.js` building pieces, the homestead, collisions, lights
- `src/audio.js` all sound, synthesized with Web Audio
- `src/post.js` god rays, bloom, dream trails and color
- `src/main.js` boot, input, UI, quality settings, main loop
