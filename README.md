# Mars AR

A 3D Mars you can hold in augmented reality. Open it on your phone, point the
camera at the room, and Mars floats in front of you. Turn the phone and the
planet stays put in space. On Android phones with ARCore you can also place it
on a table or the floor and walk around it.

## What you see

- **Surface**: the USGS Viking orbiter color mosaic, sharpened with Mars Global
  Surveyor detail (4096 × 2048).
- **Terrain**: real 3D relief built from the USGS MOLA laser-altimeter terrain
  model and calibrated against known MOLA elevations (Olympus Mons, Hellas,
  the Tharsis volcanoes, the northern plains). The **Relief** slider
  exaggerates heights 1–40×. At 1× the tallest volcano is less than 1% of the
  planet's radius, too small to see.
- **Day and night**: the Sun's position over Mars is computed for the current
  moment with the NASA GISS Mars24 algorithm (Allison & McEwen 2000). The
  readouts show Coordinated Mars Time, Mars Sol Date, the season (Ls) and the
  point where the Sun is overhead.
- **20 places**: major features and every successful landing site from
  Viking 1 to Perseverance and Zhurong. Tap a name to see its local solar time
  and whether the Sun is up there right now.
- **Phobos and Deimos**: at their true orbital distances and periods, drawn
  20× larger than life so you can see them. Their positions along the orbit
  are illustrative.

Time controls: **Live** (real time), **1 sol / 25 s** (watch a Martian day go
by), and **Seasons** (a Mars year in a few minutes, with the planet held still).

## Run it on your phone

Camera and motion sensors only work on an `https://` address, so the app has to
be served over HTTPS.

**GitHub Pages (simplest):** in the repository go to **Settings → Pages**, set
**Source** to *Deploy from a branch*, pick the branch and `/ (root)`, and save.
After a minute the app is at `https://<user>.github.io/<repo>/`. Open that on
your phone and tap **Start AR camera**.

**Locally:** run any static server from this folder, e.g.
`python3 -m http.server 8000`, then open `http://localhost:8000` on the same
computer. To reach it from a phone you need HTTPS, for example through a tunnel
such as `npx localtunnel --port 8000`.

### Modes

| Button | Works on | What it does |
| --- | --- | --- |
| Room-scale AR | Android Chrome with ARCore | WebXR: tap a surface to place Mars, walk around it |
| Start AR camera | iPhone Safari, Android Chrome | Live camera behind Mars; turning the phone looks around |
| View without camera | Everything | Mars in space; drag to spin, scroll or pinch to zoom |

On iPhone, Safari asks for permission to use motion and orientation. Tap
**Allow**, or Mars will not follow the phone.

## Files

```
index.html          page and UI
css/style.css       styles
js/app.js           3D scene, AR modes, gestures, labels
js/marsTime.js      Mars clock and Sun position (Mars24 algorithm)
js/sites.js         named features and landing sites
textures/           Mars color, normal and elevation maps; Phobos and Deimos
vendor/             three.js r160 (MIT)
```

## Data credits

- Mars color map and normal map: from the
  [Celestia](https://github.com/CelestiaProject/CelestiaContent) project, built
  from the USGS Viking MDIM color mosaic, Mars Global Surveyor imagery
  (MSSS), the NASA Photojournal, and the USGS MOLA DEM. NASA/USGS source data
  is in the public domain.
- `mars_height.png`: integrated from the MOLA-derived normal map and
  calibrated to published MOLA elevations. Expect errors of a kilometre or two
  in places.
- Phobos and Deimos maps: P. Stooke, *Stooke Small Bodies Maps V3.0*, NASA
  Planetary Data System, 2015 (CC0); Deimos map processing by Askaniy
  Anpilogov (CC BY 3.0).
- Feature coordinates: IAU Gazetteer of Planetary Nomenclature. Landing sites:
  NASA, CNSA.
- Mars time: Allison, M. & McEwen, M. (2000), *Planet. Space Sci.* 48, 215–235;
  NASA GISS Mars24.
- [three.js](https://threejs.org) r160, MIT license (`vendor/THREE_LICENSE`).
