/* ==========================================================================
   recuperar.js — pestaña RECUPERAR, cards nuevas (spec salud §2.12–§2.16).

   - §2.12 renderReadinessTiempo    — score diario + media móvil 7d (RANGO)
   - §2.13 renderEstresDiario       — estrés medio + media móvil 7d (RANGO)
   - §2.14 renderEstresSemanal      — apilado 100 % con RAMPA_ESTRES (RANGO)
   - §2.15 renderBodyBattery        — rango flotante high–low + último (RANGO)
   - §2.16 renderMensualRecuperacion — tabla mensual con ▲▼ (HISTÓRICO)

   Reglas transversales (INTERFACES.md §0/§7):
   - Chart.js 4 es GLOBAL (window.Chart) — no se importa.
   - Colores SOLO de helpers.js; constantes Garmin SIEMPRE traducidas.
   - Prohibido doble eje. suggestedMin/Max, jamás min/max fijos.
   - Tooltips en todo; leyenda solo con ≥2 series; grid solo horizontal.
   - Idempotente; sin datos → emptyState() (nunca canvas en blanco).
   ========================================================================== */
/* global Chart */

import {
  TOKENS, SERIES, ESTADO, RAMPA_ESTRES, NIVEL_READINESS, QUALIFIER_ESTRES,
  MONTH_ES, FONT_MONO, FONT_UI,
  fmtDateEs, isoWeekKey, movingAvg, emptyState, clearEmptyState,
} from './helpers.js';
import { registerChart, destroyChart } from './state.js';

/* ==========================================================================
   Utilidades locales (mismo patrón que charts.js — no viven en helpers)
   ========================================================================== */

const $id = (id) => document.getElementById(id);

/** '#rrggbb' + alpha → 'rgba(r,g,b,a)'. */
function hexA(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Número con coma decimal española (convención es-ES del proyecto). */
function fmtNum(v, dec = 1) {
  if (!Number.isFinite(v)) return '–';
  return v.toFixed(dec).replace('.', ',');
}

/** Configuración base de tooltip (superficie elevada, cifras en mono). */
function tooltipBase(extra = {}) {
  return Object.assign({
    backgroundColor: TOKENS.card2,
    borderColor: TOKENS.border,
    borderWidth: 1,
    titleColor: TOKENS.txt,
    bodyColor: TOKENS.txt,
    footerColor: TOKENS.muted,
    titleFont: { family: FONT_UI, size: 12, weight: '600' },
    bodyFont: { family: FONT_MONO, size: 12 },
    footerFont: { family: FONT_UI, size: 11 },
    padding: 10,
    cornerRadius: 6,
    boxWidth: 8,
    boxHeight: 8,
    boxPadding: 4,
  }, extra);
}

/** Escala X de categorías: sin grid vertical, sin borde, ticks mono. */
function ejeX(extra = {}) {
  return Object.assign({
    grid: { display: false },
    border: { display: false },
    ticks: {
      font: { family: FONT_MONO, size: 11 },
      color: TOKENS.muted,
      maxRotation: 0,
      autoSkip: true,
      maxTicksLimit: 10,
    },
  }, extra);
}

/** Escala Y: grid recesivo horizontal, sin borde, ticks mono. */
function ejeY(extra = {}) {
  const base = {
    grid: { color: TOKENS.grid },
    border: { display: false },
    ticks: { font: { family: FONT_MONO, size: 11 }, color: TOKENS.muted },
  };
  const out = Object.assign({}, base, extra);
  if (extra.ticks) out.ticks = Object.assign({}, base.ticks, extra.ticks);
  return out;
}

/** Leyenda estándar (solo se muestra con ≥2 series). */
function leyenda(display, extra = {}) {
  return Object.assign({
    display,
    labels: {
      color: TOKENS.muted,
      font: { family: FONT_UI, size: 11 },
    },
  }, extra);
}

/** Guard común: ¿existe data.health con al menos una fila? */
function sinHealth(ctx) {
  return !ctx || !ctx.data || !Array.isArray(ctx.data.health) || !ctx.data.health.length;
}

/** Mensaje del estado vacío durante el backfill (§3.9/INTERFACES 4.9). */
const MSG_SIN_HEALTH = 'Los datos de salud aún se están recolectando (health.json en construcción)';

/** Nivel de readiness traducido — jamás la constante cruda (regla §0.7). */
function nivelTraducido(level) {
  if (typeof level !== 'string' || !level) return '';
  return NIVEL_READINESS[level] || 'sin clasificar';
}

/** stressQualifier traducido — no listado → 'sin calificar' (contrato helpers). */
function qualifierTraducido(q) {
  if (typeof q !== 'string' || !q) return '';
  return QUALIFIER_ESTRES[q] || 'sin calificar';
}

/* ==========================================================================
   §2.12 · Training Readiness en el tiempo (RANGO, fHealth)
   ========================================================================== */

export function renderReadinessTiempo(ctx) {
  const card = $id('cardReadinessTiempo');
  if (!card) return;
  if (sinHealth(ctx)) {
    emptyState(card, MSG_SIN_HEALTH);
    return;
  }
  const dias = ctx.fHealth;
  const scores = dias.map((d) => (Number.isFinite(d.readiness_score) ? d.readiness_score : null));
  if (!scores.some(Number.isFinite)) {
    emptyState(card, 'Sin readiness en este rango · prueba 90d (existe desde el registro del reloj, ~mar 2026)');
    return;
  }
  clearEmptyState(card);

  const labels = dias.map((d) => fmtDateEs(d.date));
  const media = movingAvg(scores, 7);

  destroyChart('chartReadiness'); // destruir ANTES de reusar el canvas
  const chart = new Chart($id('chartReadiness'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'readiness',
          data: scores,
          borderColor: SERIES.s2,
          backgroundColor: SERIES.s2,
          borderWidth: 2,
          pointRadius: 3,
          pointHitRadius: 8,
          spanGaps: false, // días sin score (pre-registro / sin sync) = hueco honesto
          tension: 0.2,
          order: 0,
        },
        {
          label: 'media 7d',
          data: media,
          borderColor: TOKENS.muted,
          backgroundColor: TOKENS.muted,
          borderWidth: 1.5,
          pointRadius: 0,
          spanGaps: true,
          tension: 0.25,
          order: 1,
        },
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: leyenda(true),
        tooltip: tooltipBase({
          callbacks: {
            title: (items) => fmtDateEs(dias[items[0].dataIndex].date, true),
            label: (item) => (Number.isFinite(item.parsed.y)
              ? `${item.dataset.label}: ${item.datasetIndex === 0 ? item.parsed.y : fmtNum(item.parsed.y, 1)}`
              : null),
            // El NIVEL va en el tooltip traducido, jamás coloreando la línea (§2.12).
            footer: (items) => {
              const nivel = nivelTraducido(dias[items[0].dataIndex].readiness_level);
              return nivel ? `nivel: ${nivel}` : '';
            },
          },
        }),
      },
      scales: {
        x: ejeX(),
        y: ejeY({ suggestedMin: 0, suggestedMax: 100, ticks: { callback: (v) => `${v}` } }),
      },
    },
  });
  registerChart('chartReadiness', chart);
}

/* ==========================================================================
   §2.13 · Estrés diario (RANGO, fHealth)
   ========================================================================== */

export function renderEstresDiario(ctx) {
  const card = $id('cardEstresDiario');
  if (!card) return;
  if (sinHealth(ctx)) {
    emptyState(card, MSG_SIN_HEALTH);
    return;
  }
  const dias = ctx.fHealth;
  const valores = dias.map((d) => (Number.isFinite(d.stress_avg) ? d.stress_avg : null));
  if (!valores.some(Number.isFinite)) {
    emptyState(card, 'Sin estrés en este rango · prueba 90d');
    return;
  }
  clearEmptyState(card);

  const labels = dias.map((d) => fmtDateEs(d.date));
  const media = movingAvg(valores, 7);

  destroyChart('chartEstres'); // destruir ANTES de reusar el canvas
  const chart = new Chart($id('chartEstres'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'estrés medio',
          data: valores,
          borderColor: SERIES.s1,
          backgroundColor: SERIES.s1,
          borderWidth: 2,
          pointRadius: 3,
          pointHitRadius: 8,
          spanGaps: false, // día consultado sin dato = hueco, no interpolación
          tension: 0.2,
          order: 0,
        },
        {
          label: 'media 7d',
          data: media,
          borderColor: SERIES.s2,
          backgroundColor: SERIES.s2,
          borderWidth: 2,
          pointRadius: 0,
          spanGaps: true,
          tension: 0.25,
          order: 1,
        },
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: leyenda(true), // 2 series → leyenda visible (§2.13)
        tooltip: tooltipBase({
          callbacks: {
            title: (items) => fmtDateEs(dias[items[0].dataIndex].date, true),
            label: (item) => (Number.isFinite(item.parsed.y)
              ? `${item.dataset.label}: ${item.datasetIndex === 0 ? item.parsed.y : fmtNum(item.parsed.y, 1)}`
              : null),
            // Máximo del día y qualifier traducido (§2.13). La escala vive en la
            // nota bajo la card (ya en el HTML), NO como zonas coloreadas.
            footer: (items) => {
              const d = dias[items[0].dataIndex];
              const partes = [];
              if (Number.isFinite(d.stress_max)) partes.push(`máximo del día: ${d.stress_max}`);
              const q = qualifierTraducido(d.stress_qualifier);
              if (q) partes.push(q);
              return partes.join(' · ');
            },
          },
        }),
      },
      scales: {
        x: ejeX(),
        y: ejeY({ suggestedMin: 0, suggestedMax: 100, ticks: { callback: (v) => `${v}` } }),
      },
    },
  });
  registerChart('chartEstres', chart);
}

/* ==========================================================================
   §2.14 · Reparto semanal del estrés — apilado 100 % con RAMPA_ESTRES (RANGO)
   ========================================================================== */

/** Las 4 categorías MEDIDAS, en orden de rampa: [0]=reposo → [3]=alto. */
const CATEGORIAS_ESTRES = [
  { clave: 'stress_rest_pct', label: 'reposo' },
  { clave: 'stress_low_pct', label: 'bajo' },
  { clave: 'stress_med_pct', label: 'medio' },
  { clave: 'stress_high_pct', label: 'alto' },
];

export function renderEstresSemanal(ctx) {
  const card = $id('cardEstresSemanal');
  if (!card) return;
  if (sinHealth(ctx)) {
    emptyState(card, MSG_SIN_HEALTH);
    return;
  }

  // Agrega por semana ISO los días que traen las 4 categorías (vienen juntas
  // de get_stats: si falta una, el día no aporta al reparto).
  const semanas = new Map(); // isoWeekKey → {sumas:[4], dias, desde, hasta}
  for (const d of ctx.fHealth) {
    const vals = CATEGORIAS_ESTRES.map((c) => d[c.clave]);
    if (!vals.every(Number.isFinite)) continue;
    const clave = isoWeekKey(d.date);
    let sem = semanas.get(clave);
    if (!sem) {
      sem = { sumas: [0, 0, 0, 0], dias: 0, desde: d.date, hasta: d.date };
      semanas.set(clave, sem);
    }
    for (let i = 0; i < 4; i++) sem.sumas[i] += vals[i];
    sem.dias += 1;
    if (d.date < sem.desde) sem.desde = d.date;
    if (d.date > sem.hasta) sem.hasta = d.date;
  }
  if (!semanas.size) {
    emptyState(card, 'Sin reparto de estrés en este rango · prueba 90d');
    return;
  }
  clearEmptyState(card);

  const claves = [...semanas.keys()].sort();
  const filas = claves.map((k) => semanas.get(k));
  // REGLA DEL SPEC (§2.14, verificado): los 4 % crudos NO suman 100 (quedan
  // fuera actividad ~7 % y sin clasificar ~6 %) → se NORMALIZAN sobre su
  // propia suma. No se inventa una 5.ª categoría en la rampa.
  const normalizadas = filas.map((sem) => {
    const total = sem.sumas.reduce((a, b) => a + b, 0);
    if (!(total > 0)) return [null, null, null, null];
    return sem.sumas.map((s) => +((s / total) * 100).toFixed(1));
  });

  const labels = claves.map((k) => `S${k.slice(6)}`); // '2026-W38' → 'S38'
  const datasets = CATEGORIAS_ESTRES.map((c, i) => ({
    label: c.label,
    data: normalizadas.map((fila) => fila[i]),
    backgroundColor: RAMPA_ESTRES[i], // rampa validada §6 — claro=reposo → oscuro=alto
    borderColor: TOKENS.card,         // gap 2px entre segmentos apilados
    borderWidth: 2,
    borderSkipped: false,
    barPercentage: 0.7,
    categoryPercentage: 0.85,
    maxBarThickness: 26,
    stack: 'estres',
  }));

  destroyChart('chartEstresSemanal'); // destruir ANTES de reusar el canvas
  const chart = new Chart($id('chartEstresSemanal'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: leyenda(true),
        tooltip: tooltipBase({
          callbacks: {
            title: (items) => {
              const sem = filas[items[0].dataIndex];
              return `${labels[items[0].dataIndex]} · ${fmtDateEs(sem.desde)} – ${fmtDateEs(sem.hasta)}`;
            },
            label: (item) => (Number.isFinite(item.parsed.y)
              ? `${item.dataset.label}: ${item.parsed.y.toFixed(0)} %`
              : null),
            footer: (items) => {
              const sem = filas[items[0].dataIndex];
              return `${sem.dias} día${sem.dias === 1 ? '' : 's'} con medición · % sobre el tiempo medido`;
            },
          },
        }),
      },
      scales: {
        x: ejeX({ stacked: true }),
        y: ejeY({
          stacked: true,
          beginAtZero: true,
          suggestedMax: 100, // dominio de un apilado 100 % — sugerido, no fijo
          ticks: { callback: (v) => `${v} %` },
        }),
      },
    },
  });
  registerChart('chartEstresSemanal', chart);
}

/* ==========================================================================
   §2.15 · Body Battery: rango diario high–low (RANGO, fDaily)
   ========================================================================== */

export function renderBodyBattery(ctx) {
  const card = $id('cardBodyBattery');
  if (!card) return;
  const dias = (ctx.fDaily || []).filter(
    (d) => Number.isFinite(d.bb_low) && Number.isFinite(d.bb_high),
  );
  if (!dias.length) {
    emptyState(card, 'Sin Body Battery en este rango · prueba 90d');
    return;
  }
  clearEmptyState(card);

  const labels = dias.map((d) => fmtDateEs(d.date));
  const rangos = dias.map((d) => [d.bb_low, d.bb_high]); // barra flotante Chart.js
  const ultimos = dias.map((d) => (Number.isFinite(d.bb_last) ? d.bb_last : null));

  destroyChart('chartBodyBattery'); // destruir ANTES de reusar el canvas
  const chart = new Chart($id('chartBodyBattery'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          // Punto del último valor: S3 pleno sobre la barra translúcida (§2.15).
          type: 'line',
          label: 'último valor',
          data: ultimos,
          showLine: false,
          pointBackgroundColor: SERIES.s3,
          pointBorderColor: 'transparent',
          backgroundColor: SERIES.s3,
          borderColor: SERIES.s3,
          pointRadius: 3,
          pointHitRadius: 8,
          order: 0,
        },
        {
          type: 'bar',
          label: 'rango alto–bajo',
          data: rangos,
          backgroundColor: hexA(SERIES.s3, 0.3), // S3 al 30 % (§2.15)
          borderRadius: 4,
          borderSkipped: false, // barra flotante: redondeo en ambos extremos
          barPercentage: 0.6,
          categoryPercentage: 0.85,
          maxBarThickness: 22,
          order: 1,
        },
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: leyenda(true),
        tooltip: tooltipBase({
          callbacks: {
            title: (items) => fmtDateEs(dias[items[0].dataIndex].date, true),
            label: (item) => {
              if (item.dataset.type === 'bar') {
                const [lo, hi] = rangos[item.dataIndex];
                return `rango: ${lo}–${hi}`;
              }
              return Number.isFinite(item.parsed.y) ? `último valor: ${item.parsed.y}` : null;
            },
            footer: (items) => {
              const d = dias[items[0].dataIndex];
              const partes = [];
              if (Number.isFinite(d.bb_charged)) partes.push(`cargado +${d.bb_charged}`);
              if (Number.isFinite(d.bb_drained)) partes.push(`drenado −${d.bb_drained}`);
              return partes.join(' · ');
            },
          },
        }),
      },
      scales: {
        x: ejeX(),
        y: ejeY({
          beginAtZero: true,
          suggestedMax: 100, // dominio 0–100 de Body Battery — sugerido, no fijo
          ticks: { callback: (v) => `${v}` },
        }),
      },
    },
  });
  registerChart('chartBodyBattery', chart);
}

/* ==========================================================================
   §2.16 · Mes a mes: recuperación — tabla sin canvas (HISTÓRICO)
   ========================================================================== */

export function renderMensualRecuperacion(ctx) {
  const card = $id('cardMensualRecuperacion');
  if (!card) return;
  const tbody = $id('tablaRecuperacionBody');
  if (!tbody) return;
  if (sinHealth(ctx)) {
    emptyState(card, MSG_SIN_HEALTH);
    return;
  }

  // Agregados mensuales en cliente sobre el HISTÓRICO completo (§2.16):
  // daily (sueño h, sleep score, HRV, BB máx) + health (estrés, readiness).
  const meses = new Map(); // 'YYYY-MM' → {clave: [valores]}
  const acumula = (fecha, campo, valor) => {
    if (!Number.isFinite(valor)) return;
    const k = fecha.slice(0, 7);
    let m = meses.get(k);
    if (!m) { m = {}; meses.set(k, m); }
    if (!m[campo]) m[campo] = [];
    m[campo].push(valor);
  };
  for (const d of ctx.data.daily || []) {
    if (!d || typeof d.date !== 'string') continue;
    acumula(d.date, 'sueno', d.sleep_hours);
    acumula(d.date, 'score', d.sleep_score);
    acumula(d.date, 'hrv', d.hrv);
    acumula(d.date, 'bb', d.bb_high);
  }
  for (const h of ctx.data.health) {
    if (!h || typeof h.date !== 'string') continue;
    acumula(h.date, 'estres', h.stress_avg);
    acumula(h.date, 'readiness', h.readiness_score);
  }
  if (!meses.size) {
    emptyState(card, 'Sin datos de recuperación todavía');
    return;
  }
  clearEmptyState(card);

  const media = (arr) => (Array.isArray(arr) && arr.length
    ? arr.reduce((a, b) => a + b, 0) / arr.length
    : null);
  const filas = [...meses.keys()].sort().map((k) => {
    const m = meses.get(k);
    return {
      clave: k,
      sueno: media(m.sueno),
      score: media(m.score),
      hrv: media(m.hrv),
      estres: media(m.estres),
      readiness: media(m.readiness),
      bb: media(m.bb),
    };
  });

  // Flecha ▲▼ vs mes anterior con DIRECCIÓN DE JUICIO por métrica (§2.16):
  // en estrés, BAJAR es ▲ mejora. Color de ESTADO (legítimo: es un juicio,
  // no una serie) + texto sr-only con aria de mejor/peor.
  const flecha = (cur, prev, mejorSiSube, eps) => {
    if (!Number.isFinite(cur) || !Number.isFinite(prev) || Math.abs(cur - prev) < eps) return '';
    const sube = cur > prev;
    const mejor = sube === mejorSiSube;
    const color = mejor ? ESTADO.verde : ESTADO.rojo;
    const txt = mejor ? 'mejor' : 'peor';
    return ` <span class="trend" style="color:${color}" aria-hidden="true">${mejor ? '▲' : '▼'}</span>`
      + `<span class="sr-only"> (${txt} que el mes anterior)</span>`;
  };
  const celda = (cur, prev, fmt, mejorSiSube, eps) => (Number.isFinite(cur)
    ? `${fmt(cur)}${flecha(cur, prev, mejorSiSube, eps)}`
    : '–');

  // Columnas del thead YA escrito: Mes · Sueño · Score · HRV · Estrés · Readiness · BB máx.
  const html = filas.map((m, i) => {
    const prev = i > 0 ? filas[i - 1] : {};
    const mes = `${MONTH_ES[+m.clave.slice(5, 7) - 1]} ${m.clave.slice(2, 4)}`;
    return `<tr>
      <td>${mes}</td>
      <td class="num">${celda(m.sueno, prev.sueno, (v) => `${fmtNum(v, 1)} h`, true, 0.1)}</td>
      <td class="num">${celda(m.score, prev.score, (v) => v.toFixed(0), true, 1)}</td>
      <td class="num">${celda(m.hrv, prev.hrv, (v) => v.toFixed(0), true, 1)}</td>
      <td class="num">${celda(m.estres, prev.estres, (v) => v.toFixed(0), false, 1)}</td>
      <td class="num">${celda(m.readiness, prev.readiness, (v) => v.toFixed(0), true, 1)}</td>
      <td class="num">${celda(m.bb, prev.bb, (v) => v.toFixed(0), true, 1)}</td>
    </tr>`;
  });
  tbody.innerHTML = html.join('');
}
