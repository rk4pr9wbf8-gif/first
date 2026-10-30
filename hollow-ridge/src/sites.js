// Where the player starts and where the homestead sits.
import { getH, slopeAt, forestDensity, riverDistAt, isWet, LAKE, WATER } from './world.js';

export const spawn = { x: 0, z: 0, yaw: 0 };
export const farm = { x: 0, z: 0, ang: 0, penX: 0, penZ: 0, penR: 22 };

function flatness(x, z, r) {
  let mx = -Infinity, mn = Infinity;
  for (let a = 0; a < 8; a++) { const h = getH(x + Math.cos(a * 0.785) * r, z + Math.sin(a * 0.785) * r); mx = Math.max(mx, h); mn = Math.min(mn, h); }
  return mx - mn;
}
export function chooseSites() {
  let best = -1e9;
  for (let x = -260; x <= 260; x += 8) for (let z = -260; z <= 260; z += 8) {
    const d = Math.hypot(x - LAKE.x, z - LAKE.z);
    if (d < 170 || Math.abs(x) > 400 || Math.abs(z) > 400 || riverDistAt(x, z) < 30) continue;
    const h = getH(x, z) - d * 0.05;
    if (h > best && slopeAt(x, z) < 0.35) { best = h; spawn.x = x; spawn.z = z; }
  }
  spawn.yaw = Math.atan2(-(LAKE.x - spawn.x), -(LAKE.z - spawn.z));

  // homestead: broad flat meadow, not too far from the start, above the water
  let bs = Infinity;
  for (let x = spawn.x - 260; x <= spawn.x + 260; x += 6) for (let z = spawn.z - 260; z <= spawn.z + 260; z += 6) {
    if (Math.abs(x) > 430 || Math.abs(z) > 430) continue;
    const ds = Math.hypot(x - spawn.x, z - spawn.z); if (ds < 70) continue;
    const h = getH(x, z); if (h < WATER + 4 || isWet(x, z, 2) || riverDistAt(x, z) < 45) continue;
    const f = flatness(x, z, 30) + flatness(x, z, 14) * 1.5;
    const score = f + forestDensity(x, z) * 6 + ds * 0.012;
    if (score < bs) { bs = score; farm.x = x; farm.z = z; }
  }
  farm.ang = Math.atan2(spawn.x - farm.x, spawn.z - farm.z);
  // pen sits beside the barn, away from the start
  farm.penX = farm.x - Math.sin(farm.ang) * 30;
  farm.penZ = farm.z - Math.cos(farm.ang) * 30;
}
