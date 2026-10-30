// First-person movement: walking, wading, swimming, flying, with collisions against builds and the homestead.
import * as THREE from 'three';
import { clamp } from './noise.js';
import { BOUND, waterLevelAt } from './world.js';
import { supportHeight, blocked, hitsCeiling, PH } from './build.js';
import { sfx } from './audio.js';

export const player = { pos: new THREE.Vector3(), vy: 0, yaw: 0, pitch: -0.05, onGround: false, fly: false, eye: 1.62, bob: 0, stepT: 0 };
export function updatePlayer(dt, keys, camera) {
  const fwd = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const str = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const sprint = keys.ShiftLeft || keys.ShiftRight;
  const p = player.pos;
  const wl = waterLevelAt(p.x, p.z);
  const depth = wl - p.y;
  const inWater = depth > 0.6;
  let speed = player.fly ? (sprint ? 28 : 11) : (sprint ? 7.5 : 4.2);
  if (!player.fly) speed *= inWater ? 0.5 : depth > 0.15 ? 0.75 : 1;
  const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  let mx = -sy * fwd + cy * str, mz = -cy * fwd - sy * str;
  const ml = Math.hypot(mx, mz); if (ml > 0) { mx /= ml; mz /= ml; }
  const nx = p.x + mx * speed * dt, nz = p.z + mz * speed * dt;
  if (!blocked(nx, p.z, p.y)) p.x = clamp(nx, -BOUND, BOUND);
  if (!blocked(p.x, nz, p.y)) p.z = clamp(nz, -BOUND, BOUND);
  const ground = supportHeight(p.x, p.z, p.y);
  if (player.fly) {
    const v = ((keys.Space ? 1 : 0) - (keys.KeyC ? 1 : 0)) * speed * 0.8;
    p.y = Math.max(p.y + v * dt, ground);
    player.vy = 0;
  } else {
    player.vy -= 22 * dt;
    if (inWater) player.vy = Math.max(player.vy, -2);
    if (keys.Space && (player.onGround || inWater)) { player.vy = inWater ? 3.5 : 7.2; player.onGround = false; }
    const ny = p.y + player.vy * dt;
    if (player.vy > 0 && hitsCeiling(p.x, p.z, p.y, ny)) player.vy = 0;
    p.y += player.vy * dt;
    if (p.y <= ground) { if (!player.onGround && player.vy < -9) sfx.step(1.4, depth > 0.05); p.y = ground; player.vy = 0; player.onGround = true; }
    else if (p.y - ground > 0.08) player.onGround = false;
    if (wl > -1e8 && p.y < wl - 1.35) { p.y = wl - 1.35; player.vy = Math.max(player.vy, 0); }
  }
  const moving = ml > 0 && (player.onGround || player.fly || inWater);
  if (moving && !player.fly) {
    player.bob += dt * (sprint ? 11 : 7.5);
    player.stepT -= dt; if (player.stepT <= 0) { player.stepT = sprint ? 0.32 : 0.46; sfx.step(1, depth > 0.05); }
  } else player.bob *= 0.9;
  camera.position.set(p.x, p.y + player.eye + (player.fly ? 0 : Math.sin(player.bob) * 0.045), p.z);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
}
export { PH };
