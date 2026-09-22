/* ==========================================================================
   entrenar-garmin.js — capa Garmin de la pestaña Entrenar (spec salud §2.7–§2.10).

   Exports (INTERFACES.md §4.8, firmas congeladas):
   - renderPRsOficiales(ctx)  → #prOficialesList  · card #cardPRsOficiales · HISTÓRICO
   - renderPredicciones(ctx)  → #prediccionesGarmin + #predDistancia +
                                canvas #chartPredicciones (+#predBadge)
                                · card #cardPredicciones · HISTÓRICO
   - renderUmbral(ctx)        → #umbralKpis (+#umbralBadge) · card #cardUmbral · HISTÓRICO
   - renderCargaGarmin(ctx)   → canvas #chartCarga + #chartVo2max · card #cardCargaGarmin · HISTÓRICO

   Reglas transversales (INTERFACES.md §0 y §7):
   - Chart.js 4 es GLOBAL (window.Chart, vendorizado) — no se importa.
   - data.trends / data.prs / data.statusHistory pueden ser null (ficheros
     opcionales aún sin generar): emptyState explicativo, jamás lanzar.
   - Bandas de referencia SIEMPRE en gris neutro etiquetado (makeBandPlugin
     con sus defaults), nunca colores de estado. Prohibido doble eje Y.
   - Ejes con suggestedMin/Max, jamás min/max fijos. Leyenda solo con ≥2 series.
   - lt_speed_raw NO se pinta como ritmo mientras lt_speed_unit_verified !== true (§2.9/§8.2).
   ========================================================================== */
/* global Chart */

import {
  TOKENS, SERIES, FONT_MONO, FONT_UI,
  paceFmt, fmtDur, fmtDateEs,
  makeBandPlugin, emptyState, clearEmptyState,
} from './helpers.js';
import { registerChart, destroyChart } from './state.js';
import { openRunModal } from './modal.js';

/* ==========================================================================
   Utilidades locales (mismas convenciones que charts.js — allí son privadas)
   ========================================================================== */

const $id = (id) => document.getElementById(id);

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
  const base = {
    grid: { display: false },
    border: { display: false },
    ticks: {
      font: { family: FONT_MONO, size: 11 },
      color: TOKENS.muted,
      maxRotation: 0,
      autoSkip: true,
      maxTicksLimit: 10,
    },
  };
  const out = Object.assign({}, base, extra);
  if (extra.ticks) out.ticks = Object.assign({}, base.ticks, extra.ticks);
  return out;
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
 * KPI monospace para .kpi-grid: nombre + valor grande + subtítulo opcional.
 * El valor va SIEMPRE en tinta (.kpi-grid strong ya lo impone en CSS).
 */
function kpiItem(nombre, valor, sub = '', titulo = '') {
  const div = document.createElement('div');
  div.className = 'kpi-item';
  const span = document.createElement('span');
  span.textContent = nombre;
  const strong = document.createElement('strong');
  strong.textContent = valor;
  div.append(span, strong);
  if (sub) {
    const small = document.createElement('small');
    small.textContent = sub;
    div.appendChild(small);
  }
  if (titulo) div.title = titulo; // tooltip nativo: tooltips en todo (§2.0)
  return div;
}

/* ==========================================================================
   2.7 · Récords oficiales Garmin (HISTÓRICO) — spec salud §2.7
   ========================================================================== */

/**
 * Mapping candidato de typeId (INTERFACES.md §0.4 — prTypeLabelKey llega null
 * en el sondeo; verificar contra la app Connect el primer día, §2.7).
 * No mapeado → fallback «Récord tipo N», jamás ocultar.
 */
const PR_TIPOS = {
  1: '1 km',
  2: '1 milla',
  3: '5 km',
  4: '10 km',
  7: 'Carrera más larga',
  8: 'Media maratón',
  9: 'Maratón',
};

/** typeIds cuyo `value` son METROS (distancias); el resto son segundos. */
const PR_TIPOS_DISTANCIA = new Set([7]);

/** Formatea el valor de un PR según su tipo (fmtDur para tiempos, km para distancias). */
function valorPr(pr) {
  if (!Number.isFinite(pr.value)) return '–';
  if (PR_TIPOS_DISTANCIA.has(pr.type_id)) return `${(pr.value / 1000).toFixed(2)} km`;
  return fmtDur(pr.value);
}

export function renderPRsOficiales(ctx) {
  const card = $id('cardPRsOficiales');
  if (!card) return;
  const prs = ctx.data && ctx.data.prs;
  if (!Array.isArray(prs) || !prs.length) {
    emptyState(card, 'Los récords oficiales llegan con prs.json (lo genera el próximo run del pipeline)');
    return;
  }
  clearEmptyState(card);

  const lista = $id('prOficialesList');
  if (!lista) return;
  lista.replaceChildren();

  // Orden estable por typeId (distancias crecientes en el mapping candidato).
  const ordenados = prs.slice().sort((a, b) => {
    const ta = Number.isFinite(a && a.type_id) ? a.type_id : Infinity;
    const tb = Number.isFinite(b && b.type_id) ? b.type_id : Infinity;
    return ta - tb;
  });

  for (const pr of ordenados) {
    if (!pr) continue;
    const etiqueta = PR_TIPOS[pr.type_id] || `Récord tipo ${pr.type_id}`;
    const fecha = typeof pr.date === 'string' ? fmtDateEs(pr.date, true) : '–';
    const nombre = typeof pr.activity_name === 'string' && pr.activity_name ? pr.activity_name : '';

    const fila = document.createElement('div');
    fila.className = 'pr-row';
    const izq = document.createElement('span');
    izq.textContent = `🏆 ${etiqueta} · ${fecha}${nombre ? ` · ${nombre}` : ''}`;
    const der = document.createElement('span');
    der.className = 'pr-valor';
    der.textContent = valorPr(pr);
    fila.title = `${etiqueta}: ${der.textContent} · ${fecha}${nombre ? ` · ${nombre}` : ''}`;
    fila.append(izq, der);

    // Click/Enter abre el modal si la carrera está en el cuaderno; el guard
    // interno de openRunModal (if (!run) return) cubre las que no lo están.
    if (Number.isFinite(pr.activity_id)) {
      fila.tabIndex = 0;
      fila.setAttribute('role', 'button');
      fila.setAttribute('aria-label', `${etiqueta}: ${der.textContent} — abrir detalle de la carrera si está en el cuaderno`);
      const abrir = () => openRunModal(pr.activity_id);
      fila.addEventListener('click', abrir);
      fila.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); }
      });
    }
    lista.appendChild(fila);
  }
}

/* ==========================================================================
   2.8 · Predicciones de carrera Garmin (HISTÓRICO) — spec salud §2.8
   ========================================================================== */

/** Guarda de la tendencia: nº mínimo de snapshots en trends.json (§2.8). */
const MIN_SNAPSHOTS_PRED = 14;

/** Equivalencias de las tablas de Daniels para VDOT/VO₂max 45 (§2.7 — mismas
 *  constantes que la card legada de charts.js, que app.js oculta cuando este
 *  módulo está desplegado): 5 km ≈ 19:57 · 10 km ≈ 41:21. */
const VDOT45_5K = 1197;
const VDOT45_10K = 2481;

/**
 * §2.7: la equivalencia VO₂max sobrevive como complemento ETIQUETADO con su
 * origen. Línea idempotente #predEquivalenciaVdot bajo el grid de KPIs (la
 * card legada que la albergaba muere al desplegarse este módulo). Sin
 * status.vo2max → se retira.
 */
function pintaEquivalenciaVdot(card, status) {
  let p = $id('predEquivalenciaVdot');
  const vo2 = status && Number.isFinite(status.vo2max) ? status.vo2max : null;
  if (vo2 === null) {
    if (p) p.remove();
    return;
  }
  if (!p) {
    p = document.createElement('p');
    p.id = 'predEquivalenciaVdot';
    p.className = 'kpi-line';
    const grid = $id('prediccionesGarmin');
    if (grid) grid.insertAdjacentElement('afterend', p);
    else card.appendChild(p);
  }
  p.textContent = '';
  const cifra = (t) => {
    const s = document.createElement('strong');
    s.textContent = t;
    return s;
  };
  p.appendChild(document.createTextNode(`Tu VO₂max ${String(vo2).replace('.', ',')} equivale a ≈ `));
  p.appendChild(cifra(fmtDur(VDOT45_5K)));
  p.appendChild(document.createTextNode(' en 5 km y '));
  p.appendChild(cifra(fmtDur(VDOT45_10K)));
  p.appendChild(document.createTextNode(' en 10 km — tablas de Daniels sobre tu VO₂max Garmin.'));
}

const PRED_DISTS = [
  { clave: 'pred_5k_s', nombre: '5 km', km: 5 },
  { clave: 'pred_10k_s', nombre: '10 km', km: 10 },
  { clave: 'pred_half_s', nombre: 'Media maratón', km: 21.0975 },
  { clave: 'pred_marathon_s', nombre: 'Maratón', km: 42.195 },
];

/**
 * Predictor Riegel (exp. 1.06) sobre el mejor esfuerzo REAL del histórico —
 * mismo criterio que la card legada de charts.js: candidatas ≥2 km con
 * duración, gana el menor tiempo proyectado.
 * @returns {(distKm:number) => number|null} o null sin candidatas.
 */
function riegelPredictor(runs) {
  if (!Array.isArray(runs)) return null;
  const candidatos = runs.filter((r) => r && Number.isFinite(r.km) && r.km >= 2
    && Number.isFinite(r.dur_s) && r.dur_s > 0);
  if (!candidatos.length) return null;
  return (distKm) => {
    let mejor = null;
    for (const r of candidatos) {
      const t = r.dur_s * Math.pow(distKm / r.km, 1.06);
      if (mejor === null || t < mejor) mejor = t;
    }
    return mejor;
  };
}

/** Rellena el selector de distancia conservando la selección previa. */
function poblarSelectorPred(sel) {
  const previo = sel.value;
  sel.replaceChildren();
  for (const d of PRED_DISTS) {
    const opt = document.createElement('option');
    opt.value = d.clave;
    opt.textContent = d.nombre;
    sel.appendChild(opt);
  }
  if (PRED_DISTS.some((d) => d.clave === previo)) sel.value = previo;
}

/** Línea S1 de la predicción de la distancia elegida sobre los snapshots. */
function pintarChartPred(filas, clave) {
  const canvas = $id('chartPredicciones');
  if (!canvas) return;
  const dist = PRED_DISTS.find((d) => d.clave === clave) || PRED_DISTS[0];
  const labels = filas.map((f) => fmtDateEs(f.date));
  const datos = filas.map((f) => (Number.isFinite(f[dist.clave]) ? f[dist.clave] : null));
  const finitos = datos.filter(Number.isFinite);
  const sugMin = finitos.length ? Math.min(...finitos) * 0.98 : undefined;
  const sugMax = finitos.length ? Math.max(...finitos) * 1.02 : undefined;

  destroyChart('chartPredicciones'); // destruir ANTES de reusar el canvas
  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: dist.nombre,
        data: datos,
        borderColor: SERIES.s1,
        backgroundColor: SERIES.s1,
        borderWidth: 2,
        pointRadius: 3,
        pointHitRadius: 8,
        spanGaps: true,
        tension: 0.2,
      }],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: leyenda(false), // 1 serie → sin leyenda (el selector la nombra)
        tooltip: tooltipBase({
          callbacks: {
            title: (items) => fmtDateEs(filas[items[0].dataIndex].date, true),
            label: (item) => (Number.isFinite(item.parsed.y)
              ? `${dist.nombre}: ${fmtDur(item.parsed.y)} (${paceFmt(item.parsed.y / dist.km)} /km)`
              : null),
          },
        }),
      },
      scales: {
        x: ejeX(),
        y: ejeY({
          suggestedMin: sugMin,
          suggestedMax: sugMax,
          ticks: { callback: (v) => fmtDur(v) },
        }),
      },
    },
  });
  registerChart('chartPredicciones', chart);
}

export function renderPredicciones(ctx) {
  const card = $id('cardPredicciones');
  if (!card) return;
  const badge = $id('predBadge');
  const trends = ctx.data && ctx.data.trends;
  // Snapshots con alguna predicción (una fila podría traer solo umbral/fitness age).
  const filas = Array.isArray(trends)
    ? trends.filter((t) => t && typeof t.date === 'string'
        && PRED_DISTS.some((d) => Number.isFinite(t[d.clave])))
    : [];
  if (!filas.length) {
    if (badge) badge.textContent = '';
    destroyChart('chartPredicciones');
    const eq = $id('predEquivalenciaVdot');
    if (eq) eq.remove(); // la línea no está en el selector de emptyState
    emptyState(card, 'Las predicciones llegan con trends.json — serie nueva, nace sep 2026 (Garmin no expone histórico)');
    return;
  }
  clearEmptyState(card);

  // ---- 4 KPIs del ÚLTIMO snapshot + Riegel como segunda columna etiquetada ----
  const ultimo = filas[filas.length - 1];
  const riegel = riegelPredictor(ctx.data ? ctx.data.runs : null);
  const grid = $id('prediccionesGarmin');
  if (grid) {
    grid.replaceChildren();
    for (const d of PRED_DISTS) {
      const tGarmin = Number.isFinite(ultimo[d.clave]) ? ultimo[d.clave] : null;
      const tRiegel = riegel ? riegel(d.km) : null;
      const valor = tGarmin !== null ? fmtDur(tGarmin) : '–';
      const sub = `Garmin (Firstbeat) · Riegel: ${tRiegel !== null ? fmtDur(tRiegel) : '–'}`;
      const titulo = `Garmin (modelo Firstbeat, extrapola de tu VO₂max): ${valor}`
        + (tGarmin !== null ? ` (${paceFmt(tGarmin / d.km)} /km)` : '')
        + ` · Riegel sobre tu mejor esfuerzo real: ${tRiegel !== null ? `${fmtDur(tRiegel)} (${paceFmt(tRiegel / d.km)} /km)` : 'sin esfuerzos suficientes'}`;
      grid.appendChild(kpiItem(d.nombre, valor, sub, titulo));
    }
  }

  // §2.7: equivalencia VO₂max (tablas de Daniels) como complemento etiquetado.
  pintaEquivalenciaVdot(card, ctx.data ? ctx.data.status : null);

  // ---- Tendencia: SOLO con ≥14 snapshots (§2.8); antes, badge y [hidden] ----
  const wrap = card.querySelector('.chart-wrap');
  const controles = card.querySelector('.pred-controls');
  if (filas.length < MIN_SNAPSHOTS_PRED) {
    if (badge) badge.textContent = 'serie en construcción desde sep 2026';
    if (wrap) wrap.hidden = true;             // atributo hidden, nunca display:none inline
    if (controles) controles.hidden = true;
    destroyChart('chartPredicciones');
    return;
  }
  if (badge) badge.textContent = '';

  const sel = $id('predDistancia');
  if (sel) {
    poblarSelectorPred(sel);
    // onchange (no addEventListener): re-renders idempotentes sin duplicar listeners.
    sel.onchange = () => pintarChartPred(filas, sel.value);
    pintarChartPred(filas, sel.value);
  }
}

/* ==========================================================================
   2.9 · Umbral de lactato y potencia (HISTÓRICO, KPI sin canvas) — spec §2.9
   ========================================================================== */

/** Guarda de la tendencia diferida del umbral: nº de valores DISTINTOS de lt_hr (§2.9). */
const MIN_VALORES_UMBRAL = 5;

/** origin del FTP → español. Solo 'weight' está verificado en el sondeo;
 *  cualquier otro código → fallback genérico, jamás la constante cruda (§0.7). */
const ORIGEN_FTP = { weight: 'estimado por peso, no medido' };
const origenFtp = (o) => ORIGEN_FTP[o] || 'estimación de Garmin';

export function renderUmbral(ctx) {
  const card = $id('cardUmbral');
  if (!card) return;
  const badge = $id('umbralBadge');
  const trends = ctx.data && ctx.data.trends;
  const filas = Array.isArray(trends)
    ? trends.filter((t) => t && (Number.isFinite(t.lt_hr) || Number.isFinite(t.ftp_w)))
    : [];
  if (!filas.length) {
    if (badge) badge.textContent = '';
    const tendVieja = $id('umbralTendencia');
    if (tendVieja) tendVieja.remove(); // no está en el selector de emptyState
    emptyState(card, 'El umbral llega con trends.json — serie nueva, nace sep 2026 (Garmin no expone histórico)');
    return;
  }
  clearEmptyState(card);

  const u = filas[filas.length - 1];
  const kpis = $id('umbralKpis');
  if (kpis) {
    kpis.replaceChildren();

    if (Number.isFinite(u.lt_hr)) {
      const fechaCalc = typeof u.lt_date === 'string' ? `último recálculo: ${fmtDateEs(u.lt_date, true)}` : '';
      kpis.appendChild(kpiItem(
        'FC umbral',
        `${u.lt_hr} lpm`,
        fechaCalc,
        'FC en tu umbral de lactato estimada por el reloj · lo recalcula esporádicamente; puede pasar semanas sin cambiar',
      ));
    }
    if (Number.isFinite(u.ftp_w)) {
      kpis.appendChild(kpiItem(
        'FTP running',
        `${u.ftp_w} W`,
        origenFtp(u.ftp_origin),
        `Potencia umbral funcional de carrera · origen: ${origenFtp(u.ftp_origin)}`,
      ));
    }
    if (Number.isFinite(u.ftp_wkg)) {
      kpis.appendChild(kpiItem(
        'Potencia relativa',
        `${u.ftp_wkg.toFixed(2).replace('.', ',')} W/kg`,
        origenFtp(u.ftp_origin),
        'FTP dividido por tu peso · mismo origen que el FTP',
      ));
    }
    // Ritmo de umbral: PROHIBIDO pintarlo mientras la unidad no esté verificada
    // (§2.9/§8.2 — lt_speed_raw llega en unidad interna sin documentar; la
    // hipótesis ×10 → m/s sigue SIN confirmar y por eso NO se hardcodea aquí).
    // Solo se pinta con el flag del pipeline a true Y el factor real exportado
    // en trends.json junto al flag (lt_speed_factor: el verificador fija ambos
    // a la vez tras contrastar con la app Connect).
    if (u.lt_speed_unit_verified === true && Number.isFinite(u.lt_speed_raw) && u.lt_speed_raw > 0
        && Number.isFinite(u.lt_speed_factor) && u.lt_speed_factor > 0) {
      const ms = u.lt_speed_raw * u.lt_speed_factor; // unidad interna × factor verificado → m/s
      kpis.appendChild(kpiItem(
        'Ritmo umbral',
        `${paceFmt(1000 / ms)} /km`,
        'unidad verificada contra la app Connect',
        'Ritmo estimado en tu umbral de lactato',
      ));
    }
  }

  // Tendencia diferida (§2.9): hasta ≥5 valores DISTINTOS de lt_hr, badge
  // «serie en construcción». Al superarlos, el badge se retira Y se pinta la
  // tendencia — la card no tiene canvas, así que es textual (mismo patrón que
  // #acwrTendencia en today.js): primer → último valor y nº de recálculos.
  const conHr = filas.filter((t) => Number.isFinite(t.lt_hr));
  const distintos = new Set(conHr.map((t) => t.lt_hr)).size;
  if (badge) badge.textContent = distintos < MIN_VALORES_UMBRAL ? 'serie en construcción' : '';
  let tend = $id('umbralTendencia');
  if (distintos >= MIN_VALORES_UMBRAL && kpis) {
    // Recálculos = cambios de valor entre snapshots consecutivos (el reloj
    // recalcula esporádicamente; los snapshots repetidos no cuentan).
    const cambios = [];
    for (const t of conHr) {
      if (!cambios.length || cambios[cambios.length - 1].lt_hr !== t.lt_hr) cambios.push(t);
    }
    if (!tend) {
      tend = document.createElement('p');
      tend.id = 'umbralTendencia';
      tend.className = 'kpi-line';
      kpis.insertAdjacentElement('afterend', tend);
    }
    tend.textContent = `FC umbral: ${cambios[0].lt_hr} → ${cambios[cambios.length - 1].lt_hr} lpm `
      + `(${cambios.length} recálculos desde ${fmtDateEs(cambios[0].date, true)})`;
  } else if (tend) {
    tend.remove(); // re-render idempotente
  }
}

/* ==========================================================================
   2.10 · Carga y VO2max Garmin (HISTÓRICO) — spec salud §2.10
   Small multiples con eje X común (fechas de status_history), JAMÁS doble eje.
   ========================================================================== */

/** Guarda §2.10: nº mínimo de puntos no nulos en status_history.json. */
const MIN_PUNTOS_CARGA = 14;

export function renderCargaGarmin(ctx) {
  const card = $id('cardCargaGarmin');
  if (!card) return;
  const sh = ctx.data && ctx.data.statusHistory;
  // Filas con ALGÚN dato (tras el fix F0 no debería haber todo-null, pero la
  // guarda se mantiene: histórico con huecos, INTERFACES §0.1).
  const filas = Array.isArray(sh)
    ? sh.filter((f) => f && typeof f.date === 'string'
        && (Number.isFinite(f.acute_load) || Number.isFinite(f.chronic_load) || Number.isFinite(f.vo2max)))
    : [];
  if (filas.length < MIN_PUNTOS_CARGA) {
    destroyChart('chartCarga');
    destroyChart('chartVo2max');
    emptyState(card, filas.length
      ? `La serie de carga se está construyendo: ${filas.length} de ${MIN_PUNTOS_CARGA} días con dato — crece con cada run diario del pipeline`
      : 'Sin status_history.json con datos: la serie de carga y VO₂max llega con el pipeline');
    return;
  }
  clearEmptyState(card);

  const labels = filas.map((f) => fmtDateEs(f.date));
  const agudas = filas.map((f) => (Number.isFinite(f.acute_load) ? f.acute_load : null));
  const cronicas = filas.map((f) => (Number.isFinite(f.chronic_load) ? f.chronic_load : null));
  const vo2 = filas.map((f) => (Number.isFinite(f.vo2max) ? f.vo2max : null));

  // Misma anchura de eje Y en ambos paneles → las X quedan alineadas (patrón
  // de los small multiples de charts.js).
  const anchoY = (escala) => { escala.width = 56; };

  // ---- Panel superior: carga aguda (S1) + crónica (S2) + banda óptima gris ----
  const st = ctx.data ? ctx.data.status : null;
  const pluginsCarga = [];
  let sugMaxCarga;
  if (st && Number.isFinite(st.optimal_min) && Number.isFinite(st.optimal_max)) {
    // Banda gris etiquetada = referencia, no estado (§2.10, reusa makeBandPlugin).
    pluginsCarga.push(makeBandPlugin({
      from: st.optimal_min,
      to: st.optimal_max,
      label: `rango óptimo ${Math.round(st.optimal_min)}–${Math.round(st.optimal_max)}`,
    }));
    sugMaxCarga = st.optimal_max * 1.1; // que la banda entera quede a la vista (sugerido, no fijo)
  }

  destroyChart('chartCarga'); // destruir ANTES de reusar el canvas
  const chartCarga = new Chart($id('chartCarga'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'carga aguda',
          data: agudas,
          borderColor: SERIES.s1,
          backgroundColor: SERIES.s1,
          borderWidth: 2,
          pointRadius: 0,
          pointHitRadius: 8,
          spanGaps: true,
          tension: 0.2,
        },
        {
          label: 'carga crónica',
          data: cronicas,
          borderColor: SERIES.s2,
          backgroundColor: SERIES.s2,
          borderWidth: 2,
          pointRadius: 0,
          pointHitRadius: 8,
          spanGaps: true,
          tension: 0.2,
        },
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: leyenda(true), // 2 series → leyenda
        tooltip: tooltipBase({
          callbacks: {
            title: (items) => fmtDateEs(filas[items[0].dataIndex].date, true),
            label: (item) => (Number.isFinite(item.parsed.y)
              ? `${item.dataset.label}: ${item.parsed.y}`
              : null),
          },
        }),
      },
      scales: {
        x: ejeX({ ticks: { display: false } }), // el eje X visible vive en el panel de abajo
        y: ejeY({ suggestedMin: 0, suggestedMax: sugMaxCarga, afterFit: anchoY }),
      },
    },
    plugins: pluginsCarga,
  });
  registerChart('chartCarga', chartCarga);

  // ---- Panel inferior: VO2max escalonado S2, puntos SOLO en cambios ----
  const radios = [];
  let prevVo2 = null;
  for (const v of vo2) {
    if (Number.isFinite(v) && v !== prevVo2) {
      radios.push(3);
      prevVo2 = v;
    } else {
      radios.push(0);
    }
  }
  const vo2Finitos = vo2.filter(Number.isFinite);
  const sugMinVo2 = vo2Finitos.length ? Math.floor(Math.min(...vo2Finitos) - 1) : 40;
  const sugMaxVo2 = vo2Finitos.length ? Math.ceil(Math.max(...vo2Finitos) + 1) : 50;

  destroyChart('chartVo2max'); // destruir ANTES de reusar el canvas
  const chartVo2 = new Chart($id('chartVo2max'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'VO₂max',
        data: vo2,
        borderColor: SERIES.s2,
        backgroundColor: SERIES.s2,
        borderWidth: 2,
        stepped: true,          // línea escalonada (§2.10)
        pointRadius: radios,    // puntos solo en cambios de valor
        pointHitRadius: 8,
        spanGaps: true,
      }],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: leyenda(false), // 1 serie → sin leyenda
        tooltip: tooltipBase({
          callbacks: {
            title: (items) => fmtDateEs(filas[items[0].dataIndex].date, true),
            label: (item) => (Number.isFinite(item.parsed.y)
              ? `VO₂max: ${item.parsed.y}`
              : null),
          },
        }),
      },
      scales: {
        x: ejeX(),
        y: ejeY({ suggestedMin: sugMinVo2, suggestedMax: sugMaxVo2, afterFit: anchoY }),
      },
    },
  });
  registerChart('chartVo2max', chartVo2);
}
