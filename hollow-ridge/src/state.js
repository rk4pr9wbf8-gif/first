// Mutable state shared across modules (avoids import cycles).
export const S = {
  scene: null, camera: null, renderer: null,
  timeOfDay: 16.6, nightF: 0, dayF: 1, dream: 0,
  player: null, playing: false, quality: 'high',
  toast: () => {},
};
