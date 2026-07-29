/* ==========================================================================
   state.js — datos + rango global + registry de charts + defaults de Chart.js.
   loadData() degrada por fichero: si cae uno, el resto renderiza.
   ========================================================================== */

import { TOKENS, FONT_UI, isoAddDays, isoToday } from './helpers.js';

/* ---------- Carga de datos ---------- */

const FICHEROS = [
  ['runs', 'data/runs.json'],
  ['runsDetail', 'data/runs_detail.json'],
  ['daily', 'data/daily.json'],
  ['allActivities', 'data/all_activities.json'],
  ['status', 'data/status.json'],
  ['meta', 'data/meta.json'],
];

/**
 * Descarga los 6 JSON comprobando res.ok POR fichero (degradación parcial).
 * Los arrays (runs, daily, allActivities) se devuelven ORDENADOS ascendente
 * por `date` — los módulos pueden confiar en ese orden.
 * @returns {Promise<{data: {runs:Array|null, runsDetail:Object|null, daily:Array|null,
 *   allActivities:Array|null, status:Object|null, meta:Object|null}, errores: string[]}>}
 *   `errores` contiene los NOMBRES de fichero caídos (p.ej. 'runs_detail.json');
 *   sus claves en `data` quedan a null.
 */
export async function loadData() {
  const data = {};
  const errores = [];
  await Promise.all(FICHEROS.map(async ([clave, ruta]) => {
    try {
      const res = await fetch(ruta, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data[clave] = await res.json();
    } catch (_e) {
      data[clave] = null;
      errores.push(ruta.split('/').pop());
    }
  }));
  for (const clave of ['runs', 'daily', 'allActivities']) {
    if (Array.isArray(data[clave])) {
      data[clave].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }
  }
  return { data, errores };
}

/* ---------- Estado global ---------- */

let _data = null;
/** Rango activo: 7 | 30 | 90 | 'all'. Por defecto 90 (≈ un ciclo de bloque). */
let _range = 90;

export function setData(data) { _data = data; }
export function getData() { return _data; }

/** @param {7|30|90|'all'} r */
export function setRange(r) { _range = r === 'all' ? 'all' : Number(r); }
export function getRange() { return _range; }

/**
 * Fecha de referencia para el filtro de rango: la fecha de `meta.updated`
 * si existe; si no, la última fecha de daily/runs; si no, hoy.
 */
function refDate() {
  const d = _data || {};
  if (d.meta && typeof d.meta.updated === 'string') return d.meta.updated.slice(0, 10);
  if (Array.isArray(d.daily) && d.daily.length) return d.daily[d.daily.length - 1].date;
  if (Array.isArray(d.runs) && d.runs.length) return d.runs[d.runs.length - 1].date;
  return isoToday();
}

/**
 * Filtra filas con campo `date` por el rango dado (últimos N días incluyendo
 * la fecha de referencia). Comparación lexicográfica de ISO — sin husos.
 * @param {Array<{date:string}>|null} rows
 * @param {7|30|90|'all'} range
 * @returns {Array} nuevo array (nunca null); ya viene ordenado asc de loadData.
 */
export function filterByRange(rows, range) {
  if (!Array.isArray(rows)) return [];
  if (range === 'all') return rows.slice();
  const cutoff = isoAddDays(refDate(), -(range - 1));
  return rows.filter((r) => r.date >= cutoff);
}

/**
 * Contexto de render que reciben TODOS los constructores de módulos.
 * fRuns/fDaily se filtran y quedan ordenados UNA sola vez por render.
 * @returns {{data:object, fRuns:Array, fDaily:Array, range:(7|30|90|'all')}}
 */
export function buildCtx() {
  return {
    data: _data,
    fRuns: filterByRange(_data ? _data.runs : null, _range),
    fDaily: filterByRange(_data ? _data.daily : null, _range),
    range: _range,
  };
}

/* ---------- Registry de charts (destroy correcto en re-renders) ---------- */

const _charts = new Map();

/** Registra un chart bajo un id lógico, destruyendo el anterior si lo había. */
export function registerChart(id, chart) {
  destroyChart(id);
  _charts.set(id, chart);
}

/** Destruye y desregistra el chart `id` si existe. Seguro llamar siempre. */
export function destroyChart(id) {
  const c = _charts.get(id);
  if (c) {
    c.destroy();
    _charts.delete(id);
  }
}

/** @returns {object|undefined} instancia Chart registrada bajo `id`. */
export function getChart(id) { return _charts.get(id); }

/* ---------- Breakpoint móvil unificado (§4: matchMedia a 600px) ---------- */

/**
 * Media query única de móvil (600px, el mismo corte que style.css). Al cruzar
 * el breakpoint se fuerza el resize de todos los charts registrados para que
 * adopten la altura fija de 220px de .chart-wrap (o la vuelvan a soltar).
 */
export const mqMovil = window.matchMedia('(max-width: 600px)');
mqMovil.addEventListener('change', () => {
  for (const chart of _charts.values()) {
    try { chart.resize(); } catch (_e) { /* un chart roto no tumba el resto */ }
  }
});

/* ---------- Defaults globales de Chart.js ---------- */

/**
 * Aplica los defaults de tema a Chart.js (llamar UNA vez tras comprobar que
 * window.Chart existe). Grid recesivo, tinta muted, fuente del sistema,
 * animación off si prefers-reduced-motion.
 * @returns {boolean} false si window.Chart no está disponible.
 */
export function applyChartDefaults() {
  if (typeof Chart === 'undefined') return false;
  Chart.defaults.color = TOKENS.muted;
  Chart.defaults.borderColor = TOKENS.grid;          // grid al 50%, recesivo
  Chart.defaults.font.family = FONT_UI;
  Chart.defaults.font.size = 11;
  Chart.defaults.maintainAspectRatio = false;        // altura la manda .chart-wrap
  Chart.defaults.elements.line.borderWidth = 2;      // líneas 2px (§3)
  Chart.defaults.elements.point.radius = 3;          // puntos ≥3px
  Chart.defaults.elements.point.hitRadius = 8;       // hit-area 8px
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
  Chart.defaults.plugins.legend.labels.boxHeight = 12;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    Chart.defaults.animation = false;
  }
  return true;
}
