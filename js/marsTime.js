// Mars clock and sun position, after Allison & McEwen (2000), the algorithm
// behind NASA GISS "Mars24". Angles in degrees, times in hours.

const d2r = Math.PI / 180;
const sind = (x) => Math.sin(x * d2r);
const cosd = (x) => Math.cos(x * d2r);
const mod = (x, m) => ((x % m) + m) % m;

// Perturbations from the other planets (Table 5 of Allison & McEwen)
const PBS = [
  [0.0071, 2.2353, 49.409],
  [0.0057, 2.7543, 168.173],
  [0.0039, 1.1177, 191.837],
  [0.0037, 15.7866, 21.736],
  [0.0021, 2.1354, 15.704],
  [0.002, 2.4694, 95.528],
  [0.0018, 32.8493, 49.095],
];

const TT_MINUS_UTC_SECONDS = 37 + 32.184; // leap seconds since 2017 + TT offset

export function marsTime(date) {
  const jdUT = 2440587.5 + date.getTime() / 86400000;
  const jdTT = jdUT + TT_MINUS_UTC_SECONDS / 86400;
  const dt = jdTT - 2451545.0;

  const M = 19.3871 + 0.52402073 * dt; // mean anomaly
  const alphaFMS = 270.3871 + 0.524038496 * dt; // fictitious mean sun
  let pbs = 0;
  for (const [A, tau, phi] of PBS) pbs += A * cosd((0.985626 * dt) / tau + phi);
  const nuMinusM =
    (10.691 + 3.0e-7 * dt) * sind(M) +
    0.623 * sind(2 * M) +
    0.05 * sind(3 * M) +
    0.005 * sind(4 * M) +
    0.0005 * sind(5 * M) +
    pbs;

  const Ls = mod(alphaFMS + nuMinusM, 360); // areocentric solar longitude (season)
  const eot = 2.861 * sind(2 * Ls) - 0.071 * sind(4 * Ls) + 0.002 * sind(6 * Ls) - nuMinusM;
  const decl = Math.asin(0.42565 * sind(Ls)) / d2r + 0.25 * sind(Ls); // subsolar latitude

  const msd = (jdTT - 2405522.0028779) / 1.0274912517; // Mars Sol Date
  const mtc = mod(24 * msd, 24); // Coordinated Mars Time (mean solar time at 0°)
  const subsolarWest = mod(mtc * 15 + eot + 180, 360);
  const subLon = mod(540 - subsolarWest, 360) - 180; // east-positive, -180..180

  // Mars Year numbering of Clancy et al. (MY 1 began 1955-04-11)
  const marsYear = 1 + Math.floor((jdUT - 2435208.5) / 686.9726);

  return { Ls, eot, decl, msd, mtc, subLon, subLat: decl, marsYear };
}

// Local true solar time (hours) at an east longitude
export function localSolarTime(t, lonEast) {
  return mod(t.mtc + lonEast / 15 + t.eot / 15, 24);
}

export function season(Ls) {
  const north = ["spring", "summer", "autumn", "winter"][Math.floor(Ls / 90) % 4];
  const south = ["autumn", "winter", "spring", "summer"][Math.floor(Ls / 90) % 4];
  return { north, south };
}

export function fmtHours(h) {
  const s = Math.floor(mod(h, 24) * 3600);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  return `${hh}:${mm}`;
}
