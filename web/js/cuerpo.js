/* ==========================================================================
   cuerpo.js — pestaña CUERPO, «el panel del médico de cabecera» (C4).
   Contrato: INTERFACES.md §4.10 · spec salud §2.17–§2.23.

   Reglas transversales (INTERFACES.md §0/§7):
   - Chart.js 4 es GLOBAL (window.Chart, vendorizado) — no se importa.
   - Colores SOLO de helpers.js. Bandas de referencia SIEMPRE gris etiquetado.
   - Prohibido doble eje Y. suggestedMin/Max, jamás min/max fijos.
   - Tooltips en TODAS las gráficas. Leyenda solo con ≥2 series.
   - Cualquier clave de ctx.data y cualquier campo de fila puede ser null:
     sin lo esencial → emptyState() y return. Renders idempotentes.
   - Percentiles personales en tinta, guarda n≥60 (métricas diarias).
   ========================================================================== */
/* global Chart */

import {
  TOKENS, SERIES, MONTH_ES, FONT_MONO, FONT_UI, ESTADO,
  fmtDateEs, isoAddDays, isoToday, isoWeekKey,
  movingAvg, makeBandPlugin, emptyState, clearEmptyState,
} from './helpers.js';
import { registerChart, destroyChart } from './state.js';

/* ==========================================================================
   Utilidades locales (espejo de las de charts.js/today.js — los módulos
   no exportan estas piezas y el contrato prohíbe tocarlos)
   ========================================================================== */

const $id = (id) => document.getElementById(id);

/** '#rrggbb' + alpha → 'rgba(r,g,b,a)'. */
function hexA(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Número con coma decimal española. fmtNum(3.65) → '3,7'. */
function fmtNum(v, dec = 1) {
  if (!Number.isFinite(v)) return '–';
  return v.toFixed(dec).replace('.', ',');
}

/** Entero con separador de miles español (pasos, kcal). */
function fmtMiles(v) {
  if (!Number.isFinite(v)) return '–';
  return Math.round(v).toLocaleString('es-ES');
}

/** Crea un elemento con clase y texto opcionales (textContent: nunca HTML con datos). */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** Fecha de referencia del dataset (meta.updated; fallback último health/daily; hoy). */
function fechaRef(data) {
  const d = data || {};
  if (d.meta && typeof d.meta.updated === 'string') return d.meta.updated.slice(0, 10);
  if (Array.isArray(d.health) && d.health.length) return d.health[d.health.length - 1].date;
  if (Array.isArray(d.daily) && d.daily.length) return d.daily[d.daily.length - 1].date;
  return isoToday();
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
    labels: { color: TOKENS.muted, font: { family: FONT_UI, size: 11 } },
  }, extra);
}

/**
 * Cuantil p (0–1) por interpolación lineal sobre una copia ORDENADA de los
 * valores finitos. Devuelve null sin datos.
 */
function cuantil(valores, p) {
  const v = valores.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const idx = (v.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return v[lo] + (v[hi] - v[lo]) * (idx - lo);
}

/**
 * Filas de health de la ventana móvil de los últimos `dias` días (incluida
 * la fecha de referencia) con `campo` finito — para percentiles personales.
 */
function ventanaConDato(health, campo, refIso, dias = 90) {
  if (!Array.isArray(health)) return [];
  const corte = isoAddDays(refIso, -(dias - 1));
  return health
    .filter((h) => h && typeof h.date === 'string' && h.date >= corte && h.date <= refIso &&
      Number.isFinite(h[campo]))
    .map((h) => h[campo]);
}

/* ---------- Bullet bar SVG (mismo patrón visual que today.js §2.20) ---------- */

const NS = 'http://www.w3.org/2000/svg';

/**
 * Bullet bar horizontal: pista + tick de objetivo etiquetado (11px mono,
 * muted) + marcador vertical en tinta. La banda/tick es referencia: el
 * estado JAMÁS colorea la barra.
 * @param {{min:number, max:number, value:number|null, ticks?:{v:number,label:string}[]}} o
 */
function bulletSvg({ min, max, value, ticks = [] }) {
  const W = 320, H = 36, PAD = 6;
  const barY = 6, barH = 12;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.setAttribute('aria-hidden', 'true'); // el valor legible va en .bullet-label

  const span = max - min || 1;
  const x = (v) => PAD + ((Math.min(Math.max(v, min), max) - min) / span) * (W - 2 * PAD);
  const rect = (rx, ry, rw, rh, fill, radio) => {
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', rx.toFixed(1)); r.setAttribute('y', String(ry));
    r.setAttribute('width', Math.max(rw, 0).toFixed(1)); r.setAttribute('height', String(rh));
    r.setAttribute('fill', fill);
    if (radio) r.setAttribute('rx', String(radio));
    svg.appendChild(r);
    return r;
  };

  rect(PAD, barY, W - 2 * PAD, barH, TOKENS.card2, 6); // pista

  for (const t of ticks) {
    const tx = x(t.v);
    const linea = document.createElementNS(NS, 'line');
    linea.setAttribute('x1', tx.toFixed(1)); linea.setAttribute('x2', tx.toFixed(1));
    linea.setAttribute('y1', String(barY - 2)); linea.setAttribute('y2', String(barY + barH + 2));
    linea.setAttribute('stroke', TOKENS.muted);
    linea.setAttribute('stroke-width', '1');
    svg.appendChild(linea);
    const texto = document.createElementNS(NS, 'text');
    texto.setAttribute('x', tx.toFixed(1));
    texto.setAttribute('y', String(H - 3));
    texto.setAttribute('text-anchor', 'middle');
    texto.setAttribute('font-size', '11');
    texto.setAttribute('font-family', FONT_MONO);
    texto.setAttribute('fill', TOKENS.muted);
    texto.textContent = t.label;
    svg.appendChild(texto);
  }

  if (Number.isFinite(value)) { // marcador en tinta
    rect(x(value) - 1.5, barY - 4, 3, barH + 8, TOKENS.txt, 1.5);
  }
  return svg;
}

/**
 * Flecha de juicio ▲▼ vs mes anterior (mismo patrón que charts.js:renderMensual):
 * color de ESTADO legítimo — ES un juicio, no una serie — con texto sr-only.
 * @param {boolean} mejorSiSube dirección de juicio de la métrica
 */
function flechaMes(cur, prev, mejorSiSube, eps) {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || Math.abs(cur - prev) < eps) return '';
  const sube = cur > prev;
  const mejor = sube === mejorSiSube;
  const color = mejor ? ESTADO.verde : ESTADO.rojo;
  const txt = mejor ? 'mejor' : 'peor';
  // §2.23: la flecha es dirección de JUICIO, no del cambio (RHR que baja = ▲
  // mejora) — mismo patrón que la tabla de recuperación (§2.16).
  return ` <span class="trend" style="color:${color}" aria-hidden="true">${mejor ? '▲' : '▼'}</span>`
    + `<span class="sr-only"> (${txt} que el mes anterior)</span>`;
}

const MSG_BACKFILL = 'Los datos de salud aún se están recolectando · esta card se activará con el backfill de health.json';
const MSG_TRENDS = 'Serie de snapshots aún no generada · el pipeline crea trends.json a partir de sep 2026';

/* ==========================================================================
   §2.17 · FC EN REPOSO — línea diaria + media 7d + banda poblacional +
   percentiles personales p10/p50/p90 (RANGO, fHealth)
   ========================================================================== */

export function renderRhr(ctx) {
  const card = $id('cardRhr');
  if (!card) return;
  const { health } = ctx.data || {};
  if (!Array.isArray(health) || !health.length) {
    emptyState(card, MSG_BACKFILL);
    return;
  }
  const dias = ctx.fHealth;
  const valores = dias.map((h) => (Number.isFinite(h.rhr) ? h.rhr : null));
  if (!valores.some(Number.isFinite)) {
    emptyState(card, 'Sin FC en reposo en este rango · prueba 90d o Todo');
    return;
  }
  clearEmptyState(card);

  const labels = dias.map((h) => fmtDateEs(h.date));
  // Media 7d: preferimos la que calcula Garmin (rhr_7d); si el pipeline aún
  // no la trae en ninguna fila, media móvil propia sobre la serie diaria.
  let media7 = dias.map((h) => (Number.isFinite(h.rhr_7d) ? h.rhr_7d : null));
  if (!media7.some(Number.isFinite)) media7 = movingAvg(valores, 7);

  // Banda poblacional gris etiquetada (referencia, NO estado) — §2.17.
  const plugins = [makeBandPlugin({ from: 60, to: 100, label: '60–100 lpm · rango adulto habitual' })];

  // Percentiles PERSONALES p10/p50/p90 de los últimos 90 días con dato
  // (ventana móvil, §5): tres líneas finas muted. Guarda n≥60 (métrica diaria).
  const ventana = ventanaConDato(health, 'rhr', fechaRef(ctx.data), 90);
  if (ventana.length >= 60) {
    for (const [p, nombre] of [[0.1, 'p10'], [0.5, 'p50'], [0.9, 'p90']]) {
      const v = cuantil(ventana, p);
      if (Number.isFinite(v)) {
        plugins.push(makeBandPlugin({ y: v, dash: [2, 4], label: `${nombre} · 90d` }));
      }
    }
  }

  const finitos = valores.filter(Number.isFinite);
  const minV = Math.min(...finitos);
  const maxV = Math.max(...finitos);

  destroyChart('chartRhr'); // destruir ANTES de reusar el canvas
  const chart = new Chart($id('chartRhr'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'FC reposo',
          data: valores,
          borderColor: hexA(SERIES.s1, 0.4), // serie diaria al 40 %
          backgroundColor: hexA(SERIES.s1, 0.4),
          borderWidth: 1.5,
          pointRadius: 3,
          pointHitRadius: 8,
          spanGaps: false, // huecos honestos en días sin dato
          tension: 0.25,
        },
        {
          label: 'media 7 días',
          data: media7,
          borderColor: SERIES.s2, // protagonista (§2.17)
          backgroundColor: SERIES.s2,
          borderWidth: 2,
          pointRadius: 0,
          pointHitRadius: 8,
          spanGaps: true,
          tension: 0.3,
        },
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: leyenda(true), // 2 series
        tooltip: tooltipBase({
          callbacks: {
            title: (items) => fmtDateEs(dias[items[0].dataIndex].date, true),
            label: (item) => (Number.isFinite(item.parsed.y)
              ? `${item.dataset.label}: ${fmtNum(item.parsed.y, item.datasetIndex === 0 ? 0 : 1)} lpm`
              : null),
          },
        }),
      },
      scales: {
        x: ejeX(),
        // Eje ceñido a los datos (sugerido, nunca fijo) — la banda 60–100 se
        // ve en la parte que toque; nunca se fuerza el eje para lucirla.
        y: ejeY({
          suggestedMin: Math.floor(minV - 4),
          suggestedMax: Math.ceil(maxV + 4),
          ticks: { callback: (v) => `${v}` },
        }),
      },
    },
    plugins,
  });
  registerChart('chartRhr', chart);
}

/* ==========================================================================
   §2.18 · SpO2 DEL SUEÑO — media (línea) + mínimos como triángulos SUELTOS
   (RANGO, fHealth)
   ========================================================================== */

export function renderSpo2(ctx) {
  const card = $id('cardSpo2');
  if (!card) return;
  const { health } = ctx.data || {};
  if (!Array.isArray(health) || !health.length) {
    emptyState(card, MSG_BACKFILL);
    return;
  }
  const dias = ctx.fHealth;
  const media = dias.map((h) => (Number.isFinite(h.spo2_sleep) ? h.spo2_sleep : null));
  const minimos = dias.map((h) => (Number.isFinite(h.spo2_min) ? h.spo2_min : null));
  if (!media.some(Number.isFinite) && !minimos.some(Number.isFinite)) {
    emptyState(card, 'Sin SpO₂ del sueño en este rango · prueba 90d o Todo');
    return;
  }
  clearEmptyState(card);

  const labels = dias.map((h) => fmtDateEs(h.date));

  destroyChart('chartSpo2');
  const chart = new Chart($id('chartSpo2'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'media del sueño',
          data: media,
          borderColor: SERIES.s1,
          backgroundColor: SERIES.s1,
          borderWidth: 2,
          pointRadius: 3,
          pointHitRadius: 8,
          spanGaps: false,
          tension: 0.25,
        },
        {
          // Mínimos diarios: MISMA familia S1 al 40 %, triángulos NO unidos
          // (los mínimos aislados suelen ser artefacto de postura/perfusión).
          label: 'mínimo diario',
          data: minimos,
          borderColor: hexA(SERIES.s1, 0.4),
          backgroundColor: hexA(SERIES.s1, 0.4),
          showLine: false,
          pointStyle: 'triangle',
          pointRadius: 5,
          pointHitRadius: 8,
        },
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: leyenda(true), // 2 entradas (§2.18)
        tooltip: tooltipBase({
          callbacks: {
            title: (items) => fmtDateEs(dias[items[0].dataIndex].date, true),
            label: (item) => (Number.isFinite(item.parsed.y)
              ? `${item.dataset.label}: ${fmtNum(item.parsed.y, 0)} %`
              : null),
            footer: () => 'mínimos aislados: casi siempre artefacto del sensor',
          },
        }),
      },
      scales: {
        x: ejeX(),
        // Sugerido 85–100: nunca desde 0 ni recortando datos (un 79 expande el eje).
        y: ejeY({ suggestedMin: 85, suggestedMax: 100, ticks: { callback: (v) => `${v} %` } }),
      },
    },
    // Banda de referencia gris etiquetada — Madrid ~660 m puede restar ~1 punto (nota en HTML).
    plugins: [makeBandPlugin({ from: 95, to: 100, label: '≥95 % típico a nivel del mar' })],
  });
  registerChart('chartSpo2', chart);
}

/* ==========================================================================
   §2.19 · RESPIRACIÓN — vigilia (S1) y sueño (S3), rpm (RANGO, fHealth)
   ========================================================================== */

export function renderRespiracion(ctx) {
  const card = $id('cardRespiracion');
  if (!card) return;
  const { health } = ctx.data || {};
  if (!Array.isArray(health) || !health.length) {
    emptyState(card, MSG_BACKFILL);
    return;
  }
  const dias = ctx.fHealth;
  const vigilia = dias.map((h) => (Number.isFinite(h.resp_waking) ? h.resp_waking : null));
  const sueno = dias.map((h) => (Number.isFinite(h.resp_sleep) ? h.resp_sleep : null));
  if (!vigilia.some(Number.isFinite) && !sueno.some(Number.isFinite)) {
    emptyState(card, 'Sin datos de respiración en este rango · prueba 90d o Todo');
    return;
  }
  clearEmptyState(card);

  const labels = dias.map((h) => fmtDateEs(h.date));
  const serie = (label, data, color) => ({
    label,
    data,
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    pointRadius: 3,
    pointHitRadius: 8,
    spanGaps: false,
    tension: 0.25,
  });

  destroyChart('chartRespiracion');
  const chart = new Chart($id('chartRespiracion'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        serie('vigilia', vigilia, SERIES.s1),
        serie('sueño', sueno, SERIES.s3),
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false }, // tooltips mode:index (§2.19)
      plugins: {
        legend: leyenda(true), // 2 series
        tooltip: tooltipBase({
          callbacks: {
            title: (items) => fmtDateEs(dias[items[0].dataIndex].date, true),
            label: (item) => (Number.isFinite(item.parsed.y)
              ? `${item.dataset.label}: ${fmtNum(item.parsed.y, 0)} rpm`
              : null),
          },
        }),
      },
      scales: {
        x: ejeX(),
        y: ejeY({ suggestedMin: 8, suggestedMax: 24, ticks: { callback: (v) => `${v}` } }),
      },
    },
    // Referencia poblacional gris etiquetada, no estado.
    plugins: [makeBandPlugin({ from: 12, to: 20, label: '12–20 rpm en vigilia · rango adulto habitual' })],
  });
  registerChart('chartRespiracion', chart);
}

/* ==========================================================================
   §2.20 · EDAD FITNESS — hero de la pestaña (EXENTA, data.trends)
   ========================================================================== */

/** Último snapshot de trends con un campo finito; null si no hay. */
function ultimoSnapshotCon(trends, campo) {
  if (!Array.isArray(trends)) return null;
  for (let i = trends.length - 1; i >= 0; i--) {
    const t = trends[i];
    if (t && Number.isFinite(t[campo])) return t;
  }
  return null;
}

/** Pinta un bullet de componente de edad fitness en #edadFitnessBullets. */
function bulletComponente(cont, nombre, comp, opts) {
  const { valorTxt, min, max, ticks, tooltip } = opts;
  const wrap = el('div', 'bullet');
  if (tooltip) {
    wrap.title = tooltip;
    wrap.setAttribute('aria-label', `${nombre}: ${valorTxt}. ${tooltip}`);
  }
  const label = el('div', 'bullet-label');
  const izq = el('span', null, nombre);
  if (comp.stale === true) {
    izq.appendChild(document.createTextNode(' '));
    izq.appendChild(el('span', 'badge-metric', 'dato antiguo')); // flag stale (§2.20)
  }
  label.appendChild(izq);
  const strong = document.createElement('strong');
  strong.textContent = valorTxt;
  label.appendChild(strong);
  wrap.appendChild(label);
  wrap.appendChild(bulletSvg({ min, max, value: comp.value, ticks }));
  cont.appendChild(wrap);
}

export function renderEdadFitness(ctx) {
  const card = $id('cardEdadFitness');
  if (!card) return;
  const cifras = $id('edadFitnessCifras');
  const frase = $id('edadFitnessFrase');
  const bullets = $id('edadFitnessBullets');
  const palanca = $id('edadFitnessPalanca');
  const badge = $id('edadFitnessBadge');
  if (!cifras || !frase || !bullets || !palanca) return;

  const { trends } = ctx.data || {};
  const snap = ultimoSnapshotCon(trends, 'fitness_age');
  if (!snap) {
    // Sin trends.json (o sin ningún snapshot con edad fitness): estado vacío.
    frase.textContent = '';
    palanca.textContent = '';
    if (badge) badge.textContent = '';
    destroyChart('chartEdadFitness');
    emptyState(card, MSG_TRENDS);
    return;
  }
  clearEmptyState(card);

  // --- Tres cifras monospace grandes ---
  cifras.textContent = '';
  const cifra = (valorTxt, etiqueta) => {
    const c = el('div', 'cifra');
    const strong = document.createElement('strong');
    strong.textContent = valorTxt;
    c.appendChild(strong);
    c.appendChild(document.createTextNode(etiqueta));
    return c;
  };
  cifras.appendChild(cifra(Number.isFinite(snap.chrono_age) ? fmtNum(snap.chrono_age, 0) : '–', 'edad real'));
  cifras.appendChild(cifra(fmtNum(snap.fitness_age, 1), 'edad fitness'));
  cifras.appendChild(cifra(Number.isFinite(snap.fitness_age_achievable)
    ? fmtNum(snap.fitness_age_achievable, 1) : '–', 'alcanzable'));

  // --- Frase generada («tu cuerpo funciona 0,9 años más joven que tu DNI…») ---
  // Cifras en <strong> (el CSS .kpi-line strong ya les aplica mono+tabular-nums, §3).
  frase.textContent = '';
  const addTxt = (nodo, t) => nodo.appendChild(document.createTextNode(t));
  const addCifra = (nodo, t) => nodo.appendChild(el('strong', null, t));
  let hayFrase = false;
  if (Number.isFinite(snap.chrono_age)) {
    const delta = snap.chrono_age - snap.fitness_age;
    addTxt(frase, 'Tu cuerpo funciona ');
    addCifra(frase, fmtNum(Math.abs(delta), 1));
    addTxt(frase, ` años más ${delta >= 0 ? 'joven' : 'viejo'} que tu DNI`);
    hayFrase = true;
  }
  if (Number.isFinite(snap.fitness_age_achievable)) {
    const margen = snap.fitness_age - snap.fitness_age_achievable;
    if (margen > 0) {
      addTxt(frase, hayFrase ? '; el margen de mejora son ' : 'El margen de mejora son ');
      addCifra(frase, fmtNum(margen, 0));
      addTxt(frase, ' años');
      hayFrase = true;
    }
  }
  if (hayFrase) addTxt(frase, '.');

  // --- Bullet bars por componente ---
  // OJO (§2.20, verificado en el sondeo): comp_rhr trae SOLO {value, stale} —
  // sin targetValue ni potentialAge; no se inventan.
  bullets.textContent = '';
  const conObjetivo = []; // candidatos a «palanca más rentable»
  const fmtObjetivo = (v, dec) => `objetivo ${fmtNum(v, Number.isInteger(v) ? 0 : dec)}`;

  const defs = [
    { comp: snap.comp_bmi, nombre: 'IMC', dec: 1, unidad: '' },
    { comp: snap.comp_vig_days, nombre: 'días vigorosos/sem', dec: 1, unidad: '' },
    { comp: snap.comp_vig_min, nombre: 'min vigorosos/sem', dec: 0, unidad: '' },
  ];
  for (const d of defs) {
    const c = d.comp;
    if (!c || !Number.isFinite(c.value)) continue;
    const target = Number.isFinite(c.targetValue) ? c.targetValue : null;
    const max = Math.max(c.value, target !== null ? target : 0) * 1.25 || 1;
    let tooltip = '';
    if (Number.isFinite(c.potentialAge)) {
      const quita = snap.fitness_age - c.potentialAge;
      tooltip = `Solo ${d.nombre === 'IMC' ? 'el IMC' : 'este componente'} te quitaría `
        + `${fmtNum(quita, 1)} años (edad potencial ${fmtNum(c.potentialAge, 1)})`;
      conObjetivo.push({ nombre: d.nombre, potentialAge: c.potentialAge, priority: Number.isFinite(c.priority) ? c.priority : Infinity });
    }
    bulletComponente(bullets, d.nombre, c, {
      valorTxt: fmtNum(c.value, d.dec),
      min: 0,
      max,
      ticks: target !== null ? [{ v: target, label: fmtObjetivo(target, d.dec) }] : [],
      tooltip,
    });
  }
  // FC reposo: SOLO valor, sin marcador de objetivo ni tooltip de potencial.
  if (snap.comp_rhr && Number.isFinite(snap.comp_rhr.value)) {
    bulletComponente(bullets, 'FC reposo', snap.comp_rhr, {
      valorTxt: `${fmtNum(snap.comp_rhr.value, 0)} lpm`,
      min: 30,
      max: 100,
      ticks: [],
      tooltip: 'Garmin no da objetivo para la FC en reposo',
    });
  }

  // --- Insight de palanca: potentialAge más bajo; priority como desempate ---
  if (conObjetivo.length) {
    conObjetivo.sort((a, b) => (a.potentialAge - b.potentialAge) || (a.priority - b.priority));
    const p = conObjetivo[0];
    palanca.textContent = '';
    addTxt(palanca, `Tu palanca más rentable: ${p.nombre} — te dejaría en `);
    addCifra(palanca, fmtNum(p.potentialAge, 1)); // mono tabular vía .kpi-line strong
    addTxt(palanca, ' años.');
  } else {
    palanca.textContent = '';
  }

  // --- Tendencia: solo con ≥14 snapshots con dato; antes, badge honesto ---
  const conDato = (Array.isArray(trends) ? trends : []).filter((t) => t && Number.isFinite(t.fitness_age));
  const wrapChart = card.querySelector('.chart-wrap');
  if (conDato.length >= 14) {
    if (badge) badge.textContent = '';
    if (wrapChart) wrapChart.hidden = false;
    destroyChart('chartEdadFitness');
    const chart = new Chart($id('chartEdadFitness'), {
      type: 'line',
      data: {
        labels: conDato.map((t) => fmtDateEs(t.date)),
        datasets: [{
          label: 'edad fitness',
          data: conDato.map((t) => t.fitness_age),
          borderColor: SERIES.s1,
          backgroundColor: SERIES.s1,
          borderWidth: 2,
          pointRadius: 0,
          pointHitRadius: 8,
          spanGaps: true,
          tension: 0.25,
        }],
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: leyenda(false), // 1 serie
          tooltip: tooltipBase({
            callbacks: {
              title: (items) => fmtDateEs(conDato[items[0].dataIndex].date, true),
              label: (item) => `edad fitness: ${fmtNum(item.parsed.y, 1)} años`,
            },
          }),
        },
        scales: {
          x: ejeX(),
          y: ejeY({ ticks: { callback: (v) => fmtNum(v, 1) } }),
        },
      },
    });
    registerChart('chartEdadFitness', chart);
  } else {
    if (badge) badge.textContent = 'serie en construcción desde sep 2026';
    if (wrapChart) wrapChart.hidden = true; // [hidden], nunca display:none inline
    destroyChart('chartEdadFitness');
  }
}

/* ==========================================================================
   §2.21 · PESO E IMC (HISTÓRICO, data.daily + trends)
   ========================================================================== */

/** Categoría OMS del IMC — texto de referencia, jamás color de estado. */
function categoriaImc(bmi) {
  if (!Number.isFinite(bmi)) return null;
  if (bmi < 18.5) return 'bajo peso';
  if (bmi < 25) return 'normal';
  if (bmi < 30) return 'sobrepeso';
  return 'obesidad';
}

export function renderPeso(ctx) {
  const card = $id('cardPeso');
  if (!card) return;
  const kpi = $id('kpiImc');
  const { daily, trends } = ctx.data || {};
  const pesajes = Array.isArray(daily) ? daily.filter((d) => d && Number.isFinite(d.weight_kg)) : [];
  if (!pesajes.length) {
    if (kpi) kpi.textContent = '';
    emptyState(card, 'Sin pesajes registrados todavía · la báscula alimenta esta card');
    return;
  }
  clearEmptyState(card);

  // IMC actual desde el último snapshot de trends con comp_bmi.value.
  let bmi = null;
  if (Array.isArray(trends)) {
    for (let i = trends.length - 1; i >= 0; i--) {
      const t = trends[i];
      if (t && t.comp_bmi && Number.isFinite(t.comp_bmi.value)) { bmi = t.comp_bmi.value; break; }
    }
  }

  // KPI: «IMC actual: X (normal) · N pesajes desde mar» — contador honesto.
  if (kpi) {
    kpi.textContent = '';
    const mesPrimero = MONTH_ES[+pesajes[0].date.slice(5, 7) - 1] || '?';
    const contador = `${pesajes.length} ${pesajes.length === 1 ? 'pesaje' : 'pesajes'} desde ${mesPrimero}`;
    if (bmi !== null) {
      kpi.appendChild(document.createTextNode('IMC actual: '));
      const strong = document.createElement('strong');
      strong.textContent = fmtNum(bmi, 1);
      kpi.appendChild(strong);
      kpi.appendChild(document.createTextNode(` (${categoriaImc(bmi)}, referencia OMS) · ${contador}`));
    } else {
      kpi.appendChild(document.createTextNode(`${contador} · IMC: sin snapshot de Garmin todavía`));
    }
  }

  // Bandas OMS traducidas a kg (§2.21): la serie es kg y las bandas son de
  // IMC — jamás doble eje. altura² derivada del último pesaje y el IMC actual.
  const ultimoKg = pesajes[pesajes.length - 1].weight_kg;
  const plugins = [];
  let h2 = null;
  if (bmi !== null && bmi > 0 && Number.isFinite(ultimoKg)) {
    h2 = ultimoKg / bmi; // altura² en m²
    plugins.push(makeBandPlugin({ from: 18.5 * h2, to: 25 * h2, label: 'IMC 18,5–25 · normal (OMS)' }));
    plugins.push(makeBandPlugin({ from: 25 * h2, to: 30 * h2, label: 'IMC 25–30 · sobrepeso (OMS)' }));
  }

  const valores = pesajes.map((p) => p.weight_kg);
  const minV = Math.min(...valores);
  const maxV = Math.max(...valores);

  destroyChart('chartPeso');
  const chart = new Chart($id('chartPeso'), {
    type: 'line',
    data: {
      labels: pesajes.map((p) => fmtDateEs(p.date)),
      datasets: [{
        label: 'peso',
        data: valores,
        borderColor: hexA(SERIES.s1, 0.4), // línea al 40 % — los puntos mandan
        backgroundColor: SERIES.s1,
        pointBackgroundColor: SERIES.s1,
        pointBorderColor: SERIES.s1,
        borderWidth: 2,
        pointRadius: 4,
        pointHitRadius: 8,
        spanGaps: true,
        tension: 0.2,
      }],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: leyenda(false), // 1 serie
        tooltip: tooltipBase({
          callbacks: {
            title: (items) => fmtDateEs(pesajes[items[0].dataIndex].date, true),
            label: (item) => `peso: ${fmtNum(item.parsed.y, 1)} kg`,
            footer: (items) => (h2
              ? `IMC equivalente ≈ ${fmtNum(items[0].parsed.y / h2, 1)}`
              : ''),
          },
        }),
      },
      scales: {
        x: ejeX(),
        y: ejeY({
          suggestedMin: Math.floor(minV - 2),
          suggestedMax: Math.ceil(maxV + 2),
          ticks: { callback: (v) => `${v} kg` },
        }),
      },
    },
    plugins,
  });
  registerChart('chartPeso', chart);
}

/* ==========================================================================
   §2.22 · ACTIVIDAD DIARIA Y RECOMENDACIÓN OMS (RANGO, fHealth)
   ========================================================================== */

export function renderActividad(ctx) {
  const card = $id('cardActividad');
  if (!card) return;
  const { health } = ctx.data || {};
  if (!Array.isArray(health) || !health.length) {
    emptyState(card, MSG_BACKFILL);
    return;
  }
  const dias = ctx.fHealth;
  const hayPasos = dias.some((h) => Number.isFinite(h.steps));
  const hayIntensidad = dias.some((h) => Number.isFinite(h.intensity_mod) || Number.isFinite(h.intensity_vig));
  if (!hayPasos && !hayIntensidad) {
    emptyState(card, 'Sin datos de actividad en este rango · prueba 90d o Todo');
    return;
  }
  clearEmptyState(card);

  const wraps = card.querySelectorAll('.chart-wrap');
  const wrapPasos = wraps[0] || null;
  const wrapIntensidad = wraps[1] || null;

  // --- (a) Pasos/día + objetivo dinámico escalonado ---
  if (hayPasos) {
    if (wrapPasos) wrapPasos.hidden = false;
    const labels = dias.map((h) => fmtDateEs(h.date));
    destroyChart('chartPasos');
    const chart = new Chart($id('chartPasos'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            // El objetivo cambia a diario: línea escalonada MUTED etiquetada
            // «objetivo (dinámico)» — referencia, no serie protagonista.
            type: 'line',
            label: 'objetivo (dinámico)',
            data: dias.map((h) => (Number.isFinite(h.step_goal) ? h.step_goal : null)),
            borderColor: TOKENS.muted,
            backgroundColor: TOKENS.muted,
            borderWidth: 1.5,
            borderDash: [5, 4],
            stepped: true,
            pointRadius: 0,
            pointHitRadius: 8,
            spanGaps: true,
          },
          {
            label: 'pasos',
            data: dias.map((h) => (Number.isFinite(h.steps) ? h.steps : null)),
            backgroundColor: SERIES.s1,
            borderRadius: 4,
            barPercentage: 0.8,
            categoryPercentage: 0.9,
            maxBarThickness: 18,
          },
        ],
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: leyenda(true), // 2 series
          tooltip: tooltipBase({
            callbacks: {
              title: (items) => fmtDateEs(dias[items[0].dataIndex].date, true),
              label: (item) => (Number.isFinite(item.parsed.y)
                ? `${item.dataset.label}: ${fmtMiles(item.parsed.y)}`
                : null),
              footer: (items) => {
                const h = dias[items[0].dataIndex];
                const partes = [];
                if (Number.isFinite(h.active_kcal)) partes.push(`${fmtMiles(h.active_kcal)} kcal activas`);
                if (Number.isFinite(h.floors_up)) partes.push(`${fmtNum(h.floors_up, 0)} pisos`);
                return partes.join(' · ');
              },
            },
          }),
        },
        scales: {
          x: ejeX(),
          y: ejeY({ beginAtZero: true, ticks: { callback: (v) => fmtMiles(v) } }),
        },
      },
    });
    registerChart('chartPasos', chart);
  } else {
    if (wrapPasos) wrapPasos.hidden = true; // nunca canvas en blanco
    destroyChart('chartPasos');
  }

  // --- (b) Minutos de intensidad PONDERADOS por semana ISO vs 150 OMS ---
  if (hayIntensidad) {
    if (wrapIntensidad) wrapIntensidad.hidden = false;
    // Agregado semanal: ponderado = moderados + 2×vigorosos (así cuentan
    // Garmin y la OMS). Semana sin ningún dato → null (hueco honesto).
    const semanas = new Map(); // key → {mod, vig, conDato}
    for (const h of dias) {
      if (!h || typeof h.date !== 'string') continue;
      const k = isoWeekKey(h.date);
      if (!semanas.has(k)) semanas.set(k, { mod: 0, vig: 0, conDato: false });
      const s = semanas.get(k);
      if (Number.isFinite(h.intensity_mod)) { s.mod += h.intensity_mod; s.conDato = true; }
      if (Number.isFinite(h.intensity_vig)) { s.vig += h.intensity_vig; s.conDato = true; }
    }
    const claves = [...semanas.keys()].sort();
    const ponderado = claves.map((k) => {
      const s = semanas.get(k);
      return s.conDato ? s.mod + 2 * s.vig : null;
    });
    const maxP = Math.max(0, ...ponderado.filter(Number.isFinite));

    destroyChart('chartIntensidadSemanal');
    const chart = new Chart($id('chartIntensidadSemanal'), {
      type: 'bar',
      data: {
        labels: claves.map((k) => `S${k.slice(6)}`), // '2026-W38' → 'S38'
        datasets: [{
          label: 'min ponderados',
          data: ponderado,
          backgroundColor: SERIES.s1,
          borderRadius: 4,
          barPercentage: 0.7,
          categoryPercentage: 0.85,
          maxBarThickness: 26,
        }],
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: leyenda(false), // 1 serie
          tooltip: tooltipBase({
            callbacks: {
              title: (items) => `semana ${claves[items[0].dataIndex]}`,
              label: (item) => `${fmtNum(item.parsed.y, 0)} min ponderados`,
              footer: (items) => {
                const s = semanas.get(claves[items[0].dataIndex]);
                return s ? `${fmtNum(s.mod, 0)} moderados + 2×${fmtNum(s.vig, 0)} vigorosos` : '';
              },
            },
          }),
        },
        scales: {
          x: ejeX(),
          // Sugerido ≥160 para que la referencia de 150 sea siempre visible.
          y: ejeY({
            beginAtZero: true,
            suggestedMax: Math.max(160, Math.ceil(maxP * 1.1)),
            ticks: { callback: (v) => `${v} min` },
          }),
        },
      },
      plugins: [makeBandPlugin({ y: 150, label: '150 min/sem · recomendación OMS' })],
    });
    registerChart('chartIntensidadSemanal', chart);
  } else {
    if (wrapIntensidad) wrapIntensidad.hidden = true;
    destroyChart('chartIntensidadSemanal');
  }
}

/* ==========================================================================
   §2.23 · MES A MES: CUERPO (HISTÓRICO, daily + health + statusHistory)
   ========================================================================== */

export function renderMensualCuerpo(ctx) {
  const card = $id('cardMensualCuerpo');
  if (!card) return;
  const tbody = $id('tablaCuerpoBody');
  const { daily, health, statusHistory } = ctx.data || {};
  if (!tbody || !Array.isArray(health) || !health.length) {
    emptyState(card, 'Los datos de salud aún se están recolectando · la tabla se activará con el backfill de health.json');
    return;
  }
  clearEmptyState(card);

  const media = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const mesDe = (fila) => (fila && typeof fila.date === 'string' ? fila.date.slice(0, 7) : null);

  // Unión de meses con algún dato en cualquiera de las tres fuentes.
  const meses = new Set();
  for (const fuente of [daily, health, statusHistory]) {
    if (!Array.isArray(fuente)) continue;
    for (const fila of fuente) {
      const m = mesDe(fila);
      if (m) meses.add(m);
    }
  }
  if (!meses.size) {
    emptyState(card, 'Sin datos mensuales todavía');
    return;
  }

  const filas = [...meses].sort().map((mes) => {
    const enMes = (fuente) => (Array.isArray(fuente) ? fuente.filter((f) => mesDe(f) === mes) : []);
    const d = enMes(daily);
    const h = enMes(health);
    const sh = enMes(statusHistory);

    // VO2max de FIN de mes: el último valor no nulo del mes en status_history.
    let vo2 = null;
    for (let i = sh.length - 1; i >= 0; i--) {
      if (Number.isFinite(sh[i].vo2max)) { vo2 = sh[i].vo2max; break; }
    }

    // Min intensidad ponderados/sem: total del mes ÷ (días con dato / 7).
    const diasInt = h.filter((f) => Number.isFinite(f.intensity_mod) || Number.isFinite(f.intensity_vig));
    let intSem = null;
    if (diasInt.length) {
      const total = diasInt.reduce((a, f) =>
        a + (Number.isFinite(f.intensity_mod) ? f.intensity_mod : 0)
          + 2 * (Number.isFinite(f.intensity_vig) ? f.intensity_vig : 0), 0);
      intSem = total / (diasInt.length / 7);
    }

    return {
      mes,
      peso: media(d.map((f) => f.weight_kg).filter(Number.isFinite)),
      rhr: media(h.map((f) => f.rhr).filter(Number.isFinite)),
      vo2,
      pasos: media(h.map((f) => f.steps).filter(Number.isFinite)),
      intSem,
    };
  });

  // Dirección de juicio por métrica (§2.23): peso y RHR mejoran al BAJAR;
  // VO2max, pasos y minutos de intensidad mejoran al SUBIR.
  const html = filas.map((m, i) => {
    const prev = i > 0 ? filas[i - 1] : {};
    const mesTxt = `${MONTH_ES[+m.mes.slice(5, 7) - 1]} ${m.mes.slice(2, 4)}`;
    const celda = (v, fmt, flecha) => `<td class="num">${Number.isFinite(v) ? fmt(v) : '–'}${flecha}</td>`;
    return `<tr>
      <td>${mesTxt}</td>
      ${celda(m.peso, (v) => fmtNum(v, 1), flechaMes(m.peso, prev.peso, false, 0.05))}
      ${celda(m.rhr, (v) => fmtNum(v, 1), flechaMes(m.rhr, prev.rhr, false, 0.1))}
      ${celda(m.vo2, (v) => fmtNum(v, 1), flechaMes(m.vo2, prev.vo2, true, 0.05))}
      ${celda(m.pasos, (v) => fmtMiles(v), flechaMes(m.pasos, prev.pasos, true, 50))}
      ${celda(m.intSem, (v) => fmtNum(v, 0), flechaMes(m.intSem, prev.intSem, true, 2))}
    </tr>`;
  });
  tbody.innerHTML = html.join('');
}
