// Bundles the game into a single self-contained HTML file (no network needed except optional fonts),
// then packages it with launchers into dist/HollowRidge.zip. Also writes dist/artifact.html for web hosting.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const out = await build({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, legalComments: 'none' });
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const shell = readFileSync('shell.html', 'utf8');
const body = shell.replace('/*__GAME__*/', () => js);

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/HollowRidge', { recursive: true });
writeFileSync('dist/artifact.html', body);
const cut = body.indexOf('<canvas');
const full = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${body.slice(0, cut)}</head>\n<body>\n${body.slice(cut)}</body>\n</html>\n`;
writeFileSync('dist/HollowRidge/index.html', full);

writeFileSync('dist/HollowRidge/Play Hollow Ridge (Windows).bat', [
  '@echo off',
  'rem Opens Hollow Ridge in its own fullscreen window using Chrome or Edge,',
  'rem asking for the faster graphics card on laptops that have two.',
  'setlocal',
  'set "HERE=%~dp0"',
  'set "PAGE=file:///%HERE:\\=/%index.html"',
  'set "B="',
  'if exist "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" set "B=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"',
  'if not defined B if exist "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe" set "B=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"',
  'if not defined B if exist "%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe" set "B=%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe"',
  'if not defined B if exist "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" set "B=%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"',
  'if not defined B if exist "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" set "B=%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"',
  'if not defined B ( start "" "%HERE%index.html" & exit /b )',
  'start "" "%B%" --app="%PAGE%" --start-fullscreen --force_high_performance_gpu --ignore-gpu-blocklist --user-data-dir="%LocalAppData%\\HollowRidge"',
  '',
].join('\r\n'));
writeFileSync('dist/HollowRidge/Play Hollow Ridge (Mac).command', `#!/bin/bash
# Opens Hollow Ridge in its own fullscreen window using Chrome, Edge, Brave or Chromium.
DIR="$(cd "$(dirname "$0")" && pwd)"
URL="file://$DIR/index.html"
for APP in "Google Chrome" "Microsoft Edge" "Brave Browser" "Chromium"; do
  if [ -d "/Applications/$APP.app" ]; then
    open -na "$APP" --args --app="$URL" --start-fullscreen --force_high_performance_gpu --ignore-gpu-blocklist --user-data-dir="$HOME/Library/Application Support/HollowRidge"
    exit 0
  fi
done
open "$DIR/index.html"
`);
writeFileSync('dist/HollowRidge/play-linux.sh', `#!/bin/sh
# Opens Hollow Ridge in its own fullscreen window using Chrome or Chromium.
DIR="$(cd "$(dirname "$0")" && pwd)"
for B in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge brave-browser; do
  if command -v "$B" >/dev/null 2>&1; then
    exec "$B" --app="file://$DIR/index.html" --start-fullscreen --ignore-gpu-blocklist --user-data-dir="$HOME/.config/hollow-ridge"
  fi
done
xdg-open "$DIR/index.html"
`);
chmodSync('dist/HollowRidge/Play Hollow Ridge (Mac).command', 0o755);
chmodSync('dist/HollowRidge/play-linux.sh', 0o755);
writeFileSync('dist/HollowRidge/README.txt', `HOLLOW RIDGE
Late October in the Blue Ridge. Wander, visit the farm, follow the creek, build a cabin.

HOW TO PLAY
  Windows: double-click "Play Hollow Ridge (Windows).bat"
  Mac:     double-click "Play Hollow Ridge (Mac).command"
           (the first time, macOS may say it is from an unidentified developer:
            right-click the file, choose Open, then Open again)
  Linux:   run ./play-linux.sh
  Or just open index.html in Chrome, Edge, Brave or Firefox.

The launchers open the game in its own fullscreen window and ask your computer
for its faster graphics card (on laptops that have two), which helps it run smoothly.
Everything runs offline. Your builds are saved on this computer.

CONTROLS
  WASD + mouse ......... walk and look (Shift = faster)
  Space / F ............ jump / toggle flying (Space and C to rise and sink)
  Left click an animal . pet it (the farm dog will start following you)
  Right / Left click ... place a building piece / take it back
  1-0, mouse wheel ..... choose a piece      R ... rotate it
  Q / E ................ move time backward / forward    T ... hold time still
  V .................... dream level (gentle color flow, trails, aurora)
  B .................... building on/off     H ... hide HUD
  M .................... music on/off        G ... cycle graphics (Low / High / Ultra)
  Esc .................. pause menu (dream, time, volume, graphics)

If it feels slow, pick "Low" graphics in the pause menu. "Auto" (the default) steps
down by itself if the first few seconds run slowly.
`);
rmSync('dist/HollowRidge.zip', { force: true });
execSync('cd dist && zip -qrX HollowRidge.zip HollowRidge');
const kb = (f) => Math.round(readFileSync(f).length / 1024);
console.log(`built: index.html ${kb('dist/HollowRidge/index.html')} KB, zip ${kb('dist/HollowRidge.zip')} KB`);
