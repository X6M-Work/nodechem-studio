/**
 * Route presets and dispersion defaults.
 *
 * The modern default route is B3LYP-D3(BJ)/def2-SVP: B3LYP has no built-in
 * dispersion, so a new route pairs it with Grimme D3(BJ) empirical dispersion
 * (`EmpiricalDispersion=GD3BJ`) and the modern def2-SVP basis.
 *
 * Methods whose Gaussian implementation already contains dispersion must not
 * receive a second empirical correction. Keep that an explicit allow-list:
 * guessing from the method name risks silently double-counting dispersion.
 */

export const DEFAULT_DISPERSION = 'GD3BJ';

/** Methods that already include a dispersion correction in Gaussian 16. */
export const BUILTIN_DISPERSION_METHODS = Object.freeze([
  'ωB97X-D',
  'wB97X-D',
  'wB97X-D3',
  'wB97X-V',
  'wB97M-V',
  'B97-D',
  'B97-D3',
]);

function methodKey(method) {
  return String(method ?? '')
    .trim()
    .toLowerCase()
    .replace(/ω/g, 'w')
    .replace(/[^a-z0-9]/g, '');
}

const BUILTIN_DISPERSION_KEYS = new Set(BUILTIN_DISPERSION_METHODS.map(methodKey));

/** True when the method already carries its own dispersion correction. */
export function hasBuiltinDispersion(method) {
  return BUILTIN_DISPERSION_KEYS.has(methodKey(method));
}

/** Dispersion default for a method: none when built in, otherwise D3(BJ). */
export function defaultDispersionFor(method) {
  return hasBuiltinDispersion(method) ? '' : DEFAULT_DISPERSION;
}

/**
 * Dispersion after an explicit method change in the inspector. A built-in
 * correction replaces any empirical keyword; otherwise keep an explicit
 * GD3/GD3BJ choice and supply D3(BJ) when the field is still None.
 */
export function dispersionForMethodChange(method, currentDispersion = '') {
  if (hasBuiltinDispersion(method)) return '';
  return currentDispersion || DEFAULT_DISPERSION;
}

export const MODERN_ROUTE_PRESET = Object.freeze({
  id: 'modern',
  label: 'Modern default (B3LYP-D3(BJ)/def2-SVP)',
  method: 'B3LYP',
  basis: 'def2-SVP',
  dispersion: DEFAULT_DISPERSION,
});

/**
 * The pre-issue default. Kept byte-identical so an old input can still be
 * reproduced exactly; this is not the default for new projects or nodes.
 */
export const LEGACY_ROUTE_PRESET = Object.freeze({
  id: 'legacy',
  label: 'Legacy (reproduce a paper)',
  method: 'B3LYP',
  basis: '6-31G(d)',
  dispersion: '',
});

export const ROUTE_PRESETS = Object.freeze([MODERN_ROUTE_PRESET, LEGACY_ROUTE_PRESET]);

/** Preset id matching the current method/basis/dispersion, or '' for custom. */
export function routePresetIdFor(settings = {}) {
  const dispersion = settings.dispersion || '';
  const preset = ROUTE_PRESETS.find((item) => (
    item.method === settings.method
    && item.basis === settings.basis
    && item.dispersion === dispersion
  ));
  return preset ? preset.id : '';
}

/** Return a copy of `settings` with the preset's route fields applied. */
export function applyRoutePreset(settings, presetId) {
  const preset = ROUTE_PRESETS.find((item) => item.id === presetId);
  if (!preset) return { ...settings };
  return {
    ...settings,
    method: preset.method,
    basis: preset.basis,
    dispersion: preset.dispersion,
  };
}
