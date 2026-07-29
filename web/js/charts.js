/* ==========================================================================
   charts.js — todas las gráficas Chart.js del cuaderno (spec §5) + tabla
   mes a mes + PRs/predicciones + KPI laterales.

   Reglas transversales (INTERFACES.md §0 y spec §10):
   - Chart.js 4 es GLOBAL (window.Chart, vendorizado) — no se importa.
   - Colores SOLO de helpers.js. Texto en tokens de tinta, nunca en color de serie.
   - Prohibido doble eje Y. Ejes con suggestedMin/Max, jamás min/max fijos.
   - Tooltips en TODAS las gráficas. Leyenda solo con ≥2 series.
   - Grid recesivo solo horizontal. Líneas 2px, barras finas redondeadas 4px.
   - Cada chart se registra con registerChart(<canvasId>, chart) (destroy previo).
   - Todo render es idempotente y degrada a emptyState() si faltan datos.
   ========================================================================== */
/* global Chart */

import {
  TOKENS, SERIES, ESTADO, RAMPA_ZONAS, RAMPA_SUENO, MONTH_ES, FONT_MONO, FONT_UI,
  paceFmt, fmtDur, fmtDateEs, isoAddDays,
  movingAvg, linreg, makeBandPlugin, emptyState, clearEmptyState,
} from './helpers.js';
import { registerChart, getChart, destroyChart } from './state.js';
import { openRunModal } from './modal.js';

/* ==========================================================================
   Utilidades locales
   ========================================================================== */

const $id = (id) => document.getElementById(id);

/** Techo de Z2 del usuario (ppm). Único sitio donde vive el 142. */
const TECHO_Z2 = 142;

/** '#rrggbb' + alpha → 'rgba(r,g,b,a)'. */
function hexA(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Lunes (ISO 'YYYY-MM-DD') de la semana a la que pertenece la fecha. */
function lunesDe(iso) {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  const dia = (d.getUTCDay() + 6) % 7; // lunes=0 … domingo=6
  return isoAddDays(iso, -dia);
}

/** Número de semana ISO ('S30') a partir del lunes de la semana. */
function etiquetaSemana(lunesIso) {
  // isoWeekKey daría '2026-W30'; aquí solo queremos el ordinal corto.
  const jueves = isoAddDays(lunesIso, 3);
  const y = +jueves.slice(0, 4);
  const ene4 = `${y}-01-04`;
  const dias = Math.round(
    (Date.UTC(y, +jueves.slice(5, 7) - 1, +jueves.slice(8, 10)) -
     Date.UTC(y, 0, 4)) / 86400000,
  );
  const sem = 1 + Math.floor((dias + ((new Date(Date.UTC(y, 0, 4)).getUTCDay() + 6) % 7)) / 7);
  return `S${String(sem).padStart(2, '0')}`;
}

/** Lista de lunes consecutivos entre dos fechas (ambas inclusive por semana). */
function semanasEntre(isoDesde, isoHasta) {
  const semanas = [];
  let lun = lunesDe(isoDesde);
  const fin = lunesDe(isoHasta);
  let guarda = 0;
  while (lun <= fin && guarda++ < 520) {
    semanas.push(lun);
    lun = isoAddDays(lun, 7);
  }
  return semanas;
}

/** Fecha de referencia del dataset (día de meta.updated; fallback último run). */
function fechaRef(ctx) {
  const meta = ctx.data && ctx.data.meta;
  if (meta && typeof meta.updated === 'string') return meta.updated.slice(0, 10);
  const runs = ctx.data && ctx.data.runs;
  if (Array.isArray(runs) && runs.length) return runs[runs.length - 1].date;
  return null;
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
      font: { family: FONT_MONO, size: 11 }, // labels mínimos 11px (§3)
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
  // merge superficial + ticks anidados
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

/**
 * Desacople aeróbico de una carrera desde sus splits (spec §5-3.3):
 * EF (m/min ÷ ppm) de la 1.ª mitad vs 2.ª mitad POR DISTANCIA, partiendo
 * proporcionalmente el split que cruza el ecuador. Positivo = pierdes
 * eficiencia en la 2.ª mitad. Devuelve null si los splits no dan.
 */
function desacopleDeSplits(splits) {
  if (!Array.isArray(splits) || splits.length < 2) return null;
  const tot = splits.reduce((a, s) => a + (Number.isFinite(s.km) ? s.km : 0), 0);
  if (!(tot > 0)) return null;
  const mitad = tot / 2;
  let acc = 0;
  const h1 = [];
  const h2 = [];
  for (const s of splits) {
    if (!Number.isFinite(s.km) || !Number.isFinite(s.dur_s) || !Number.isFinite(s.hr)) return null;
    const antes = acc;
    acc += s.km;
    if (acc <= mitad) h1.push(s);
    else if (antes >= mitad) h2.push(s);
    else {
      const f = (mitad - antes) / s.km;
      h1.push({ km: s.km * f, dur_s: s.dur_s * f, hr: s.hr });
      h2.push({ km: s.km * (1 - f), dur_s: s.dur_s * (1 - f), hr: s.hr });
    }
  }
  const efMitad = (h) => {
    const km = h.reduce((a, s) => a + s.km, 0);
    const dur = h.reduce((a, s) => a + s.dur_s, 0);
    if (!(km > 0) || !(dur > 0)) return NaN;
    const fc = h.reduce((a, s) => a + s.hr * s.dur_s, 0) / dur;
    return ((km * 1000) / (dur / 60)) / fc; // m/min por ppm
  };
  const e1 = efMitad(h1);
  const e2 = efMitad(h2);
  if (!Number.isFinite(e1) || !Number.isFinite(e2) || e1 <= 0) return null;
  return ((e1 - e2) / e1) * 100;
}

/**
 * Plugin de crosshair vertical sincronizado entre los dos small multiples
 * (spec §5-3.2, ~40 líneas). Si algo falla, el catch deja el fallback
 * aceptado: tooltips mode:'index' independientes por panel.
 */
function makeCrosshairSync(selfId, peerId) {
  return {
    id: `crosshair_${selfId}`,
    afterEvent(chart, args) {
      const ev = args.event;
      const peer = getChart(peerId);
      if (ev.type === 'mouseout' || !args.inChartArea) {
        chart.$crossX = null;
        args.changed = true;
        if (peer && peer.$crossX != null) {
          peer.$crossX = null;
          try {
            peer.setActiveElements([]);
            peer.tooltip.setActiveElements([], { x: 0, y: 0 });
            peer.update('none');
          } catch (_e) { /* fallback: tooltips independientes */ }
        }
        return;
      }
      if (ev.type !== 'mousemove') return;
      const els = chart.getElementsAtEventForMode(ev, 'index', { intersect: false }, true);
      if (!els.length) return;
      const idx = els[0].index;
      chart.$crossX = els[0].element.x;
      args.changed = true;
      if (!peer) return;
      try {
        const el = peer.getDatasetMeta(0).data[idx];
        if (!el) return;
        peer.$crossX = el.x;
        peer.setActiveElements([{ datasetIndex: 0, index: idx }]);
        peer.tooltip.setActiveElements([{ datasetIndex: 0, index: idx }], { x: el.x, y: el.y });
        peer.update('none');
      } catch (_e) { /* fallback: tooltips independientes */ }
    },
    afterDraw(chart) {
      if (chart.$crossX == null) return;
      const { ctx: c, chartArea } = chart;
      c.save();
      c.strokeStyle = hexA('#94a0b3', 0.45); // muted translúcido, no color de serie
      c.lineWidth = 1;
      c.setLineDash([3, 3]);
      c.beginPath();
      c.moveTo(chart.$crossX, chartArea.top);
      c.lineTo(chart.$crossX, chartArea.bottom);
      c.stroke();
      c.restore();
    },
  };
}

let contadorUltimo = 0;
/** Plugin: etiqueta directa del último valor no nulo del dataset 0. */
function makeUltimoValorPlugin(fmt) {
  return {
    id: `ultimoValor${contadorUltimo++}`,
    afterDatasetsDraw(chart) {
      const data = chart.data.datasets[0] ? chart.data.datasets[0].data : [];
      let i = data.length - 1;
      while (i >= 0 && !Number.isFinite(data[i])) i--;
      if (i < 0) return;
      const el = chart.getDatasetMeta(0).data[i];
      if (!el) return;
      const { ctx: c, chartArea } = chart;
      const txt = fmt(data[i]);
      c.save();
      c.font = `11px ${FONT_MONO}`;
      c.fillStyle = TOKENS.txt;
      const cabeDerecha = el.x + 8 + c.measureText(txt).width <= chartArea.right;
      c.textAlign = cabeDerecha ? 'left' : 'right';
      c.textBaseline = 'middle';
      c.fillText(txt, cabeDerecha ? el.x + 8 : el.x - 8, el.y);
      c.restore();
    },
  };
}

/* ==========================================================================
   2.2 · Km por semana ISO + media móvil 4 sem (RANGO) — spec §5-2.2
   ========================================================================== */

export function renderKmSemana(ctx) {
  const card = $id('cardKmSemana');
  if (!card) return;
  if (!ctx.fRuns.length) {
    emptyState(card, 'Sin carreras en este rango · prueba 90d');
    return;
  }
  clearEmptyState(card);

  const ref = fechaRef(ctx) || ctx.fRuns[ctx.fRuns.length - 1].date;
  const lunes = semanasEntre(ctx.fRuns[0].date, ref);
  const kmPorLunes = new Map(lunes.map((l) => [l, 0]));
  for (const r of ctx.fRuns) {
    const l = lunesDe(r.date);
    if (kmPorLunes.has(l)) kmPorLunes.set(l, kmPorLunes.get(l) + (r.km || 0));
  }
  const kms = lunes.map((l) => +kmPorLunes.get(l).toFixed(2));
  const media = movingAvg(kms, 4);
  const idxEnCurso = lunes.length - 1; // la última semana enumerada llega hasta la fecha de referencia

  const labels = lunes.map((l, i) => (i === idxEnCurso ? `${etiquetaSemana(l)} · en curso` : etiquetaSemana(l)));
  // Semana en curso: relleno al 40 % (spec) — sigue siendo S1, no un color nuevo.
  const fondos = lunes.map((_, i) => (i === idxEnCurso ? hexA(SERIES.s1, 0.4) : SERIES.s1));

  destroyChart('chartKmSemana'); // Chart.js exige destruir ANTES de reusar el canvas
  const chart = new Chart($id('chartKmSemana'), {
    type: 'bar', // mixto: la media móvil declara type:'line' en su dataset
    data: {
      labels,
      datasets: [
        {
          type: 'line',
          label: 'media 4 sem',
          data: media,
          borderColor: SERIES.s2,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
          spanGaps: true,
          order: 0,
        },
        {
          type: 'bar',
          label: 'km/semana',
          data: kms,
          backgroundColor: fondos,
          borderRadius: 4,
          borderSkipped: 'start', // redondeo solo en el extremo, anclado a la baseline
          barPercentage: 0.6,
          categoryPercentage: 0.85,
          maxBarThickness: 26,
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
            title: (items) => {
              const l = lunes[items[0].dataIndex];
              return `${fmtDateEs(l)} – ${fmtDateEs(isoAddDays(l, 6))}`;
            },
            label: (item) => (Number.isFinite(item.parsed.y)
              ? `${item.dataset.label}: ${item.parsed.y.toFixed(1)} km`
              : `${item.dataset.label}: –`),
          },
        }),
      },
      scales: {
        x: ejeX(),
        y: ejeY({ beginAtZero: true, suggestedMax: 10, ticks: { callback: (v) => `${v} km` } }),
      },
    },
  });
  registerChart('chartKmSemana', chart);
}

/* ==========================================================================
   2.3 · Récords personales + predicciones (HISTÓRICO) — spec §5-2.3
   ========================================================================== */

export function renderPRs(ctx) {
  const card = $id('cardPRs');
  if (!card) return;
  const runs = ctx.data.runs;
  if (!Array.isArray(runs) || !runs.length) {
    emptyState(card, 'Sin carreras registradas todavía');
    return;
  }
  clearEmptyState(card);

  const conPace = runs.filter((r) => Number.isFinite(r.pace_s) && r.pace_s > 0);
  const conEf = runs.filter((r) => Number.isFinite(r.ef));

  // 1) Mejor ritmo medio de una carrera.
  const mejorRitmo = conPace.reduce((a, r) => (a && a.pace_s <= r.pace_s ? a : r), null);
  // 2) Mejor km de splits (splits ≥0.8 km para no premiar parciales ruidosos).
  let mejorKm = null;
  const detail = ctx.data.runsDetail;
  if (detail) {
    for (const [id, d] of Object.entries(detail)) {
      for (const s of (d && d.splits) || []) {
        if (Number.isFinite(s.km) && s.km >= 0.8 && Number.isFinite(s.dur_s)) {
          const p = s.dur_s / s.km;
          if (!mejorKm || p < mejorKm.pace) mejorKm = { pace: p, id: Number(id) };
        }
      }
    }
  }
  // 3) Carrera más larga.
  const masLarga = runs.reduce((a, r) => (a && a.km >= r.km ? a : r), null);
  // 4) Mejor EF.
  const mejorEf = conEf.reduce((a, r) => (a && a.ef >= r.ef ? a : r), null);
  // 5) Mejor semana (km) y 6) mejor mes (km).
  const porSemana = new Map();
  const porMes = new Map();
  for (const r of runs) {
    const l = lunesDe(r.date);
    porSemana.set(l, (porSemana.get(l) || 0) + (r.km || 0));
    const m = r.date.slice(0, 7);
    porMes.set(m, (porMes.get(m) || 0) + (r.km || 0));
  }
  const mejorSemana = [...porSemana.entries()].reduce((a, b) => (a && a[1] >= b[1] ? a : b), null);
  const mejorMes = [...porMes.entries()].reduce((a, b) => (a && a[1] >= b[1] ? a : b), null);

  const fechaDeId = (id) => {
    const r = runs.find((x) => x.id === id);
    return r ? fmtDateEs(r.date) : '';
  };

  const prs = [
    mejorRitmo && { etiqueta: 'Mejor ritmo', fecha: fmtDateEs(mejorRitmo.date), valor: `${paceFmt(mejorRitmo.pace_s)} /km`, runId: mejorRitmo.id },
    mejorKm && { etiqueta: 'Mejor km (splits)', fecha: fechaDeId(mejorKm.id), valor: `${paceFmt(mejorKm.pace)} /km`, runId: mejorKm.id },
    masLarga && { etiqueta: 'Más larga', fecha: fmtDateEs(masLarga.date), valor: `${masLarga.km.toFixed(2)} km`, runId: masLarga.id },
    mejorEf && { etiqueta: 'Mejor EF', fecha: fmtDateEs(mejorEf.date), valor: mejorEf.ef.toFixed(2), runId: mejorEf.id },
    mejorSemana && { etiqueta: 'Mejor semana', fecha: `sem. ${fmtDateEs(mejorSemana[0])}`, valor: `${mejorSemana[1].toFixed(2)} km` },
    mejorMes && {
      etiqueta: 'Mejor mes',
      fecha: `${MONTH_ES[+mejorMes[0].slice(5, 7) - 1]} ${mejorMes[0].slice(2, 4)}`,
      valor: `${mejorMes[1].toFixed(1)} km`,
    },
  ].filter(Boolean);

  const lista = $id('prList');
  lista.replaceChildren();
  for (const pr of prs) {
    const fila = document.createElement('div');
    fila.className = 'pr-row';
    const izq = document.createElement('span');
    izq.textContent = `🏆 ${pr.etiqueta} · ${pr.fecha}`;
    const der = document.createElement('span');
    der.className = 'pr-valor';
    der.textContent = pr.valor;
    fila.append(izq, der);
    if (pr.runId != null) {
      fila.tabIndex = 0;
      fila.setAttribute('role', 'button');
      fila.setAttribute('aria-label', `${pr.etiqueta}: ${pr.valor} — abrir detalle de la carrera`);
      const abrir = () => openRunModal(pr.runId);
      fila.addEventListener('click', abrir);
      fila.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); }
      });
    }
    lista.appendChild(fila);
  }

  // ---- Predicciones: Riegel (exp 1.06) desde el mejor esfuerzo real ----
  const pred = $id('predicciones');
  pred.replaceChildren();
  const RIEGEL = 1.06;
  const candidatos = runs.filter((r) => Number.isFinite(r.km) && r.km >= 2 && Number.isFinite(r.dur_s));
  const riegel = (distKm) => {
    let mejor = null;
    for (const r of candidatos) {
      const t = r.dur_s * Math.pow(distKm / r.km, RIEGEL);
      if (mejor === null || t < mejor) mejor = t;
    }
    return mejor;
  };
  const p5 = riegel(5);
  const p10 = riegel(10);
  // Equivalencias aproximadas de VDOT/VO2max 45 (tablas de Daniels): 5k ≈ 19:57, 10k ≈ 41:21.
  const VDOT45_5K = 1197;
  const VDOT45_10K = 2481;
  const partes = [];
  if (p5 !== null && p10 !== null) {
    const linea = document.createElement('p');
    linea.innerHTML = `Riegel: 5 km en <strong>${fmtDur(p5)}</strong> (${paceFmt(p5 / 5)} /km) · `
      + `10 km en <strong>${fmtDur(p10)}</strong> (${paceFmt(p10 / 10)} /km)`;
    partes.push(linea);
  }
  const vo2 = ctx.data.status && Number.isFinite(ctx.data.status.vo2max) ? ctx.data.status.vo2max : null;
  if (vo2 !== null && p5 !== null) {
    const linea = document.createElement('p');
    const gapMin = Math.max(0, Math.round((p5 - VDOT45_5K) / 60));
    linea.innerHTML = `Tu VO₂max ${vo2} equivale a ≈ <strong>${fmtDur(VDOT45_5K)}</strong> en 5 km `
      + `y <strong>${fmtDur(VDOT45_10K)}</strong> en 10 km — `
      + (gapMin > 0
        ? `hay ~<strong>${gapMin} min</strong> de potencial por delante: el motor ya lo tienes.`
        : 'ya corres a la altura de tu motor aeróbico.');
    partes.push(linea);
  }
  if (!partes.length) {
    const linea = document.createElement('p');
    linea.textContent = 'Sin esfuerzos suficientes (≥2 km) para estimar predicciones.';
    partes.push(linea);
  }
  pred.append(...partes);
}

/* ==========================================================================
   3.1 · Eficiencia aeróbica, 3 series (RANGO) — spec §5-3.1
   ========================================================================== */

export function renderEF(ctx) {
  const card = $id('cardEF');
  if (!card) return;
  const runs = ctx.fRuns.filter((r) => Number.isFinite(r.ef));
  if (!runs.length) {
    emptyState(card, 'Sin carreras con EF en este rango · prueba 90d');
    return;
  }
  clearEmptyState(card);

  // ☀ en la etiqueta del eje para carreras con calor (>24 °C).
  const labels = runs.map((r) => fmtDateEs(r.date) + (Number.isFinite(r.temp_c) && r.temp_c > 24 ? ' ☀' : ''));
  const efTodas = runs.map((r) => r.ef);
  const efZ2 = runs.map((r) => (Number.isFinite(r.hr) && r.hr <= TECHO_Z2 ? r.ef : null));
  // Ajuste por temperatura (estimación etiquetada): el calor infla la FC y
  // deprime el EF ≈1,5 % por cada 5 °C sobre 15 °C → estimamos el EF «sin calor».
  const efAjust = runs.map((r) => {
    if (!Number.isFinite(r.temp_c) || r.temp_c <= 15) return r.ef;
    return +(r.ef * (1 + 0.003 * (r.temp_c - 15))).toFixed(3);
  });

  // Tendencia lineal del EF Z2 (solo dentro del tramo con datos Z2).
  const idxs = [];
  const ysZ2 = [];
  efZ2.forEach((v, i) => { if (Number.isFinite(v)) { idxs.push(i); ysZ2.push(v); } });
  const ajuste = linreg(idxs, ysZ2);
  let tendencia = null;
  if (ajuste && idxs.length >= 3) {
    const desde = idxs[0];
    const hasta = idxs[idxs.length - 1];
    tendencia = labels.map((_, i) => (i >= desde && i <= hasta
      ? +(ajuste.intercept + ajuste.slope * i).toFixed(4)
      : null));
  }

  const datasets = [
    {
      label: 'EF Z2 (FC≤142)',
      data: efZ2,
      borderColor: SERIES.s2,
      backgroundColor: SERIES.s2,
      pointBackgroundColor: SERIES.s2,
      borderWidth: 2,
      pointRadius: 3,
      spanGaps: true,
      tension: 0.2,
      order: 0,
    },
    {
      label: 'EF todas',
      data: efTodas,
      showLine: false,
      pointBackgroundColor: hexA(SERIES.s1, 0.4),
      pointBorderColor: 'transparent',
      backgroundColor: hexA(SERIES.s1, 0.4),
      borderColor: hexA(SERIES.s1, 0.4),
      pointRadius: 3,
      order: 2,
    },
    {
      label: 'ajustado (estimación)',
      data: efAjust,
      borderColor: hexA(SERIES.s1, 0.6),
      backgroundColor: hexA(SERIES.s1, 0.6),
      borderWidth: 2,
      borderDash: [2, 4],
      pointRadius: 0,
      spanGaps: true,
      tension: 0.2,
      order: 3,
    },
  ];
  if (tendencia) {
    datasets.push({
      label: 'tendencia Z2',
      data: tendencia,
      borderColor: TOKENS.muted,
      borderWidth: 1.5,
      borderDash: [6, 4],
      pointRadius: 0,
      spanGaps: true,
      order: 1,
    });
  }

  destroyChart('chartEF'); // destruir ANTES de reusar el canvas
  const chart = new Chart($id('chartEF'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      interaction: { mode: 'index', intersect: false },
      // Drill-down §6.3: punto de EF → modal de la carrera (guard if(!r), §5-6.1).
      onClick: (evt, _els, chart) => {
        const el = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, true)[0];
        if (!el) return;
        const r = runs[el.index];
        if (!r) return;
        openRunModal(r.id);
      },
      onHover: (evt, els) => {
        const target = evt.native && evt.native.target;
        if (target) target.style.cursor = els.length ? 'pointer' : 'default';
      },
      plugins: {
        legend: leyenda(true, {
          labels: {
            color: TOKENS.muted,
            font: { family: FONT_UI, size: 11 },
            // La tendencia es referencia, no serie: fuera de la leyenda.
            filter: (item) => item.text !== 'tendencia Z2',
          },
        }),
        tooltip: tooltipBase({
          // La tendencia tampoco «habla» en el tooltip (coherente con scatter.js).
          filter: (item) => item.dataset.label !== 'tendencia Z2',
          callbacks: {
            label: (item) => (Number.isFinite(item.parsed.y)
              ? `${item.dataset.label}: ${item.parsed.y.toFixed(2)}`
              : null),
            footer: (items) => {
              const r = runs[items[0].dataIndex];
              return Number.isFinite(r.temp_c) && r.temp_c > 24
                ? `☀ ${r.temp_c.toFixed(0)} °C — el calor infla la FC, no es retroceso`
                : '';
            },
          },
        }),
      },
      scales: {
        x: ejeX(),
        // suggestedMin/Max, JAMÁS min/max fijos: el 0.98 real nunca se recorta.
        y: ejeY({ suggestedMin: 0.7, suggestedMax: 1.0 }),
      },
    },
  });
  registerChart('chartEF', chart);

  // Badge «Z2: +X % desde <mes base>» — calculado sobre el HISTÓRICO completo
  // para que la frase no cambie con el rango.
  const badge = $id('efBadge');
  if (badge) badge.textContent = badgeEfZ2(ctx.data.runs);
}

/** Mejora % del EF Z2: primer mes con ≥2 carreras Z2 vs últimos 30 días (o últimas 3). */
function badgeEfZ2(runs) {
  if (!Array.isArray(runs)) return '';
  const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const z2 = runs.filter((r) => Number.isFinite(r.ef) && Number.isFinite(r.hr) && r.hr <= TECHO_Z2);
  if (z2.length < 5) return '';
  const porMes = new Map();
  for (const r of z2) {
    const k = r.date.slice(0, 7);
    if (!porMes.has(k)) porMes.set(k, []);
    porMes.get(k).push(r.ef);
  }
  const mesBase = [...porMes.keys()].sort().find((k) => porMes.get(k).length >= 2);
  if (!mesBase) return '';
  const base = porMes.get(mesBase);
  const mediaBase = base.reduce((a, b) => a + b, 0) / base.length;
  const recientes = z2.slice(-3).map((r) => r.ef);
  const mediaRec = recientes.reduce((a, b) => a + b, 0) / recientes.length;
  if (!(mediaBase > 0) || recientes.length < 2) return '';
  const pct = ((mediaRec - mediaBase) / mediaBase) * 100;
  if (Math.abs(pct) < 1) return '';
  return `Z2: ${pct > 0 ? '+' : ''}${pct.toFixed(0)} % desde ${MESES_LARGO[+mesBase.slice(5, 7) - 1]}`;
}

/* ==========================================================================
   3.2 · Ritmo y FC media — small multiples sincronizados (RANGO) — spec §5-3.2
   ========================================================================== */

export function renderRitmoFc(ctx) {
  const card = $id('cardRitmoFc');
  if (!card) return;
  const runs = ctx.fRuns.filter((r) => Number.isFinite(r.pace_s) || Number.isFinite(r.hr));
  if (!runs.length) {
    emptyState(card, 'Sin carreras en este rango · prueba 90d');
    return;
  }
  clearEmptyState(card);

  const labels = runs.map((r) => fmtDateEs(r.date));
  const ritmos = runs.map((r) => (Number.isFinite(r.pace_s) ? r.pace_s : null));
  const fcs = runs.map((r) => (Number.isFinite(r.hr) ? r.hr : null));

  // Misma anchura de eje Y en ambos paneles → las X quedan alineadas y el
  // crosshair cae en la misma vertical.
  const anchoY = (escala) => { escala.width = 56; };

  destroyChart('chartRitmo'); // destruir ANTES de reusar el canvas
  const chartRitmo = new Chart($id('chartRitmo'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'ritmo',
        data: ritmos,
        borderColor: SERIES.s1,
        backgroundColor: SERIES.s1,
        borderWidth: 2,
        pointRadius: 3,
        spanGaps: true,
        tension: 0.2,
      }],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: leyenda(false), // 1 serie → sin leyenda (el título la nombra)
        tooltip: tooltipBase({
          callbacks: {
            label: (item) => `ritmo: ${paceFmt(item.parsed.y)} /km`,
          },
        }),
      },
      scales: {
        x: ejeX({ ticks: { display: false } }), // el eje X visible vive en el panel de abajo
        y: ejeY({
          reverse: true, // más rápido arriba
          afterFit: anchoY,
          ticks: { callback: (v) => paceFmt(v) },
        }),
      },
    },
    plugins: [makeCrosshairSync('chartRitmo', 'chartFc')],
  });
  registerChart('chartRitmo', chartRitmo);

  destroyChart('chartFc'); // destruir ANTES de reusar el canvas
  const chartFc = new Chart($id('chartFc'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'FC media',
        data: fcs,
        borderColor: SERIES.s3,
        backgroundColor: SERIES.s3,
        borderWidth: 2,
        pointRadius: 3,
        spanGaps: true,
        tension: 0.2,
      }],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: leyenda(false),
        tooltip: tooltipBase({
          callbacks: {
            label: (item) => `FC media: ${item.parsed.y} ppm`,
          },
        }),
      },
      scales: {
        x: ejeX(),
        y: ejeY({ suggestedMin: 125, suggestedMax: 155, afterFit: anchoY }),
      },
    },
    plugins: [
      makeBandPlugin({ y: TECHO_Z2, label: `techo Z2 · ${TECHO_Z2}` }),
      makeCrosshairSync('chartFc', 'chartRitmo'),
    ],
  });
  registerChart('chartFc', chartFc);
}

/* ==========================================================================
   3.3 · Desacople aeróbico (RANGO) — spec §5-3.3
   ========================================================================== */

export function renderDesacople(ctx) {
  const card = $id('cardDesacople');
  if (!card) return;
  // Null-safe: si los datos aún no han cargado (click en rango antes del fetch),
  // caemos en el emptyState en vez de lanzar TypeError.
  const detail = ctx.data && ctx.data.runsDetail;
  if (!detail) {
    emptyState(card, 'Falta runs_detail.json: sin splits no hay desacople');
    return;
  }
  // Solo carreras ≥3 km (evita falsos positivos en distancias cortas).
  const filas = [];
  for (const r of ctx.fRuns) {
    if (!Number.isFinite(r.km) || r.km < 3) continue;
    const d = detail[String(r.id)];
    if (!d || !Array.isArray(d.splits)) continue;
    const drift = desacopleDeSplits(d.splits);
    if (drift === null) continue;
    filas.push({ run: r, drift: +drift.toFixed(1) });
  }
  if (!filas.length) {
    emptyState(card, 'Sin carreras ≥3 km con splits en este rango · prueba 90d');
    return;
  }
  clearEmptyState(card);

  const labels = filas.map(({ run }) => fmtDateEs(run.date)
    + (Number.isFinite(run.temp_c) && run.temp_c > 24 ? ' ☀' : ''));

  destroyChart('chartDesacople'); // destruir ANTES de reusar el canvas
  const chart = new Chart($id('chartDesacople'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'desacople',
        data: filas.map((f) => f.drift),
        backgroundColor: SERIES.s1, // el estado vive en los umbrales, NUNCA en la barra
        borderRadius: 4,
        borderSkipped: 'start',
        barPercentage: 0.6,
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
            label: (item) => `desacople: ${item.parsed.y.toFixed(1)} %`,
            footer: (items) => {
              const { run } = filas[items[0].dataIndex];
              const partes = [`${run.km.toFixed(2)} km · ritmo ${paceFmt(run.pace_s)}`];
              if (Number.isFinite(run.temp_c) && run.temp_c > 24) {
                partes.push(`☀ ${run.temp_c.toFixed(0)} °C — calor`);
              }
              return partes.join('\n');
            },
          },
        }),
      },
      scales: {
        x: ejeX(),
        y: ejeY({
          suggestedMin: 0,
          suggestedMax: 12, // que los dos umbrales se vean siempre
          ticks: { callback: (v) => `${v} %` },
        }),
      },
    },
    plugins: [
      // Umbrales con icono+texto en color de ESTADO (etiqueta, no serie).
      makeBandPlugin({ y: 5, lineColor: ESTADO.ambar, label: '⚠ 5 %', labelColor: ESTADO.ambar }),
      makeBandPlugin({ y: 10, lineColor: ESTADO.rojo, label: '✕ 10 %', labelColor: ESTADO.rojo }),
    ],
  });
  registerChart('chartDesacople', chart);
}

/* ==========================================================================
   3.4 · Mes a mes — tabla sin canvas (HISTÓRICO) — spec §5-3.4
   ========================================================================== */

export function renderMensual(ctx) {
  const card = $id('cardMensual');
  if (!card) return;
  const runs = ctx.data.runs;
  const tbody = $id('tablaMensualBody');
  if (!Array.isArray(runs) || !runs.length || !tbody) {
    if (card) emptyState(card, 'Sin carreras registradas todavía');
    return;
  }
  clearEmptyState(card);

  const porMes = new Map();
  for (const r of runs) {
    const k = r.date.slice(0, 7);
    if (!porMes.has(k)) porMes.set(k, []);
    porMes.get(k).push(r);
  }
  const media = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const meses = [...porMes.keys()].sort().map((k) => {
    const rs = porMes.get(k);
    const val = (campo) => media(rs.map((r) => r[campo]).filter(Number.isFinite));
    return {
      clave: k,
      km: rs.reduce((a, r) => a + (r.km || 0), 0),
      ritmo: val('pace_s'),
      fc: val('hr'),
      ef: val('ef'),
      cad: val('cadence'),
    };
  });

  // Flecha de juicio vs mes anterior: ▲/▼ + texto sr-only, color de ESTADO
  // (legítimo: ES un juicio, no una serie). Ritmo y FC mejoran al BAJAR.
  const flecha = (cur, prev, mejorSiSube, eps) => {
    if (!Number.isFinite(cur) || !Number.isFinite(prev) || Math.abs(cur - prev) < eps) return '';
    const sube = cur > prev;
    const mejor = sube === mejorSiSube;
    const color = mejor ? ESTADO.verde : ESTADO.rojo;
    const txt = mejor ? 'mejor' : 'peor';
    return ` <span class="trend" style="color:${color}" aria-hidden="true">${sube ? '▲' : '▼'}</span>`
      + `<span class="sr-only"> (${txt} que el mes anterior)</span>`;
  };

  const filas = meses.map((m, i) => {
    const prev = i > 0 ? meses[i - 1] : {};
    const mes = `${MONTH_ES[+m.clave.slice(5, 7) - 1]} ${m.clave.slice(2, 4)}`;
    return `<tr>
      <td>${mes}</td>
      <td class="num">${m.km.toFixed(1)}${flecha(m.km, prev.km, true, 0.05)}</td>
      <td class="num">${paceFmt(m.ritmo)}${flecha(m.ritmo, prev.ritmo, false, 1)}</td>
      <td class="num">${Number.isFinite(m.fc) ? m.fc.toFixed(1) : '–'}${flecha(m.fc, prev.fc, false, 0.1)}</td>
      <td class="num">${Number.isFinite(m.ef) ? m.ef.toFixed(3) : '–'}${flecha(m.ef, prev.ef, true, 0.002)}</td>
      <td class="num">${Number.isFinite(m.cad) ? m.cad.toFixed(1) : '–'}${flecha(m.cad, prev.cad, true, 0.1)}</td>
    </tr>`;
  });
  tbody.innerHTML = filas.join('');
}

/* ==========================================================================
   4.1 · Tiempo en zonas FC — apilado 100 % semanal (HISTÓRICO) — spec §5-4.1
   ========================================================================== */

export function renderZonas(ctx) {
  const card = $id('cardZonas');
  if (!card) return;
  const runs = ctx.data.runs;
  const detail = ctx.data.runsDetail;
  if (!Array.isArray(runs) || !runs.length || !detail) {
    emptyState(card, 'Faltan runs_detail.json o carreras: sin zonas que agregar');
    return;
  }

  // Agrega secs por zona y semana ISO usando TODAS las carreras con detalle.
  const primeras = runs[0].date;
  const ultimas = runs[runs.length - 1].date;
  const lunes = semanasEntre(primeras, ultimas);
  const idxSemana = new Map(lunes.map((l, i) => [l, i]));
  const secs = lunes.map(() => [0, 0, 0, 0, 0]); // [semana][zona-1]
  for (const r of runs) {
    const d = detail[String(r.id)];
    if (!d || !Array.isArray(d.zones)) continue;
    const i = idxSemana.get(lunesDe(r.date));
    if (i === undefined) continue;
    for (const z of d.zones) {
      if (Number.isFinite(z.zone) && z.zone >= 1 && z.zone <= 5 && Number.isFinite(z.secs)) {
        secs[i][z.zone - 1] += z.secs;
      }
    }
  }
  const totales = secs.map((fila) => fila.reduce((a, b) => a + b, 0));
  if (!totales.some((t) => t > 0)) {
    emptyState(card, 'Ninguna carrera trae zonas de FC');
    return;
  }
  clearEmptyState(card);

  const labels = lunes.map((l) => etiquetaSemana(l));
  const datasets = RAMPA_ZONAS.map((color, zi) => ({
    label: `Z${zi + 1}`,
    data: secs.map((fila, wi) => (totales[wi] > 0 ? +(fila[zi] / totales[wi] * 100).toFixed(1) : null)),
    backgroundColor: color,
    // Gap 2px entre segmentos: borde del color de la superficie de card.
    borderColor: TOKENS.card,
    borderWidth: 2,
    borderSkipped: false,
    barPercentage: 0.7,
    categoryPercentage: 0.85,
    maxBarThickness: 26,
    stack: 'zonas',
  }));

  destroyChart('chartZonas'); // destruir ANTES de reusar el canvas
  const chart = new Chart($id('chartZonas'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: leyenda(true),
        tooltip: tooltipBase({
          callbacks: {
            title: (items) => {
              const l = lunes[items[0].dataIndex];
              return `${etiquetaSemana(l)} · ${fmtDateEs(l)} – ${fmtDateEs(isoAddDays(l, 6))}`;
            },
            label: (item) => {
              const s = secs[item.dataIndex][item.datasetIndex];
              return s > 0 ? `${item.dataset.label}: ${item.parsed.y.toFixed(0)} % · ${fmtDur(s)}` : null;
            },
            footer: (items) => {
              const t = totales[items[0].dataIndex];
              return t > 0 ? `total: ${fmtDur(t)}` : 'semana sin carreras con zonas';
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
  registerChart('chartZonas', chart);

  // KPI lateral: % del tiempo total en Z1-Z2 (zonas Garmin — etiquetado honesto).
  const kpi = $id('kpiZonas');
  if (kpi) {
    const total = totales.reduce((a, b) => a + b, 0);
    const z12 = secs.reduce((a, fila) => a + fila[0] + fila[1], 0);
    if (total > 0) {
      const pct = Math.round((z12 / total) * 100);
      kpi.innerHTML = `<strong>~${pct} %</strong> del tiempo en Z1-Z2<br>referencia 80/20 · zonas Garmin`;
    } else {
      kpi.textContent = '';
    }
  }
}

/* ==========================================================================
   4.2 · Control de intensidad — FC media vs 142 (RANGO) — spec §5-4.2
   ========================================================================== */

export function renderIntensidad(ctx) {
  const card = $id('cardIntensidad');
  if (!card) return;
  const runs = ctx.fRuns.filter((r) => Number.isFinite(r.hr));
  if (!runs.length) {
    emptyState(card, 'Sin carreras con FC en este rango · prueba 90d');
    return;
  }
  clearEmptyState(card);

  const labels = runs.map((r) => fmtDateEs(r.date));
  // Puntos por encima del techo: anillo 2px del color de la superficie
  // (injerto Base 142 — se distinguen sin gastar el rojo de estado).
  const bordes = runs.map((r) => (r.hr > TECHO_Z2 ? TOKENS.card : SERIES.s3));
  const anchos = runs.map((r) => (r.hr > TECHO_Z2 ? 2 : 0));

  destroyChart('chartIntensidad'); // destruir ANTES de reusar el canvas
  const chart = new Chart($id('chartIntensidad'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'FC media',
        data: runs.map((r) => r.hr),
        showLine: false,
        pointBackgroundColor: SERIES.s3,
        backgroundColor: SERIES.s3,
        borderColor: SERIES.s3,
        pointBorderColor: bordes,
        pointBorderWidth: anchos,
        pointRadius: 5,
        pointHoverRadius: 6,
        pointHitRadius: 8,
      }],
    },
    options: {
      interaction: { mode: 'nearest', intersect: false }, // puntos sueltos → nearest
      plugins: {
        legend: leyenda(false), // 1 serie
        tooltip: tooltipBase({
          callbacks: {
            label: (item) => {
              const r = runs[item.dataIndex];
              const dentro = r.hr <= TECHO_Z2 ? 'dentro de Z2' : `por encima del techo ${TECHO_Z2}`;
              return `FC ${r.hr} ppm (${dentro}) · ${r.km.toFixed(2)} km · ritmo ${paceFmt(r.pace_s)}`;
            },
          },
        }),
      },
      scales: {
        x: ejeX(),
        y: ejeY({ suggestedMin: 125, suggestedMax: 160, ticks: { callback: (v) => `${v}` } }),
      },
    },
    plugins: [makeBandPlugin({ y: TECHO_Z2, label: `techo Z2 · ${TECHO_Z2}` })],
  });
  registerChart('chartIntensidad', chart);

  const kpi = $id('kpiIntensidad');
  if (kpi) {
    const dentro = runs.filter((r) => r.hr <= TECHO_Z2).length;
    const pct = Math.round((dentro / runs.length) * 100);
    kpi.innerHTML = `<strong>${dentro}/${runs.length}</strong> carreras dentro de Z2 (${pct} %)`;
  }
}

/* ==========================================================================
   4.3 · Cadencia — banda objetivo 160–165, outliers excluidos (RANGO) — §5-4.3
   ========================================================================== */

export function renderCadencia(ctx) {
  const card = $id('cardCadencia');
  if (!card) return;
  const runs = ctx.fRuns.filter((r) => Number.isFinite(r.cadence));
  if (!runs.length) {
    emptyState(card, 'Sin carreras con cadencia en este rango · prueba 90d');
    return;
  }
  clearEmptyState(card);

  // Outliers <120 spm (relojes despistados) fuera de la serie, pero contados.
  const excluidos = runs.filter((r) => r.cadence < 120).length;
  const valores = runs.map((r) => (r.cadence >= 120 ? r.cadence : null));
  if (!valores.some(Number.isFinite)) {
    emptyState(card, 'Toda la cadencia del rango es outlier (<120 spm)');
    return;
  }
  const labels = runs.map((r) => fmtDateEs(r.date));
  const media = movingAvg(valores, 4);

  destroyChart('chartCadencia'); // destruir ANTES de reusar el canvas
  const chart = new Chart($id('chartCadencia'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'cadencia',
          data: valores,
          borderColor: SERIES.s4,
          backgroundColor: SERIES.s4,
          borderWidth: 2,
          pointRadius: 3,
          spanGaps: true,
          tension: 0.2,
          order: 0,
        },
        {
          label: 'media 4 carreras',
          data: media,
          borderColor: hexA(SERIES.s4, 0.5),
          backgroundColor: hexA(SERIES.s4, 0.5),
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
        legend: leyenda(true),
        tooltip: tooltipBase({
          callbacks: {
            label: (item) => (Number.isFinite(item.parsed.y)
              ? `${item.dataset.label}: ${item.parsed.y.toFixed(1)} spm`
              : null),
          },
        }),
      },
      scales: {
        x: ejeX(),
        // Sugeridos para que la banda 160–165 siempre quede a la vista.
        y: ejeY({ suggestedMin: 130, suggestedMax: 168, ticks: { callback: (v) => `${v}` } }),
      },
    },
    plugins: [makeBandPlugin({ from: 160, to: 165, label: 'objetivo 160–165' })],
  });
  registerChart('chartCadencia', chart);

  const kpi = $id('kpiCadencia');
  if (kpi) kpi.innerHTML = kpiCadenciaTexto(ctx.data.runs, valores, excluidos);
}

/** Texto del KPI de cadencia: gap al objetivo + estancamiento + outliers. */
function kpiCadenciaTexto(runsHistorico, valoresRango, excluidos) {
  const partes = [];
  const validos = valoresRango.filter(Number.isFinite);
  if (validos.length) {
    const ult = validos.slice(-4);
    const mediaUlt = ult.reduce((a, b) => a + b, 0) / ult.length;
    const gap = Math.round(160 - mediaUlt);
    if (gap > 0) partes.push(`<strong>gap al objetivo: −${gap} spm</strong>`);
    else partes.push('<strong>dentro del objetivo</strong>');
  }
  // Estancamiento: primer mes con datos vs último, sobre el histórico completo.
  if (Array.isArray(runsHistorico) && runsHistorico.length) {
    const porMes = new Map();
    for (const r of runsHistorico) {
      if (!Number.isFinite(r.cadence) || r.cadence < 120) continue;
      const k = r.date.slice(0, 7);
      if (!porMes.has(k)) porMes.set(k, []);
      porMes.get(k).push(r.cadence);
    }
    const claves = [...porMes.keys()].sort();
    if (claves.length >= 3) {
      const media = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
      const primera = media(porMes.get(claves[0]));
      const ultima = media(porMes.get(claves[claves.length - 1]));
      if (Math.abs(ultima - primera) < 2) {
        const mes = MONTH_ES[+claves[0].slice(5, 7) - 1];
        partes.push(`estancada desde ${mes} (${primera.toFixed(1)} → ${ultima.toFixed(1)})`);
      }
    }
  }
  if (excluidos > 0) {
    partes.push(`${excluidos} outlier${excluidos === 1 ? '' : 's'} &lt;120 spm excluido${excluidos === 1 ? '' : 's'}`);
  }
  return partes.join(' · ');
}

/* ==========================================================================
   5.1 · Sueño — fases reales apiladas (RANGO, usa fDaily) — spec §5-5.1
   ========================================================================== */

/** Hora decimal (1.65) → '01:39'. Devuelve null si no es finita. */
function horaFmt(dec) {
  if (!Number.isFinite(dec)) return null;
  let h = Math.floor(dec);
  let m = Math.round((dec - h) * 60);
  if (m === 60) { h += 1; m = 0; }
  return `${String(((h % 24) + 24) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function renderSueno(ctx) {
  const card = $id('cardSueno');
  if (!card) return;
  const noches = ctx.fDaily.filter((d) => Number.isFinite(d.sleep_hours) && d.sleep_hours > 0);
  if (!noches.length) {
    emptyState(card, 'Sin datos de sueño en este rango · prueba 90d');
    return;
  }
  clearEmptyState(card);

  const labels = noches.map((d) => fmtDateEs(d.date));
  const profundo = noches.map((d) => (Number.isFinite(d.deep_pct) ? +(d.sleep_hours * d.deep_pct / 100).toFixed(2) : 0));
  const rem = noches.map((d) => (Number.isFinite(d.rem_pct) ? +(d.sleep_hours * d.rem_pct / 100).toFixed(2) : 0));
  // «Ligero» = resto de horas (incluye toda la noche si no hay % de fases).
  const ligero = noches.map((d, i) => +Math.max(0, d.sleep_hours - profundo[i] - rem[i]).toFixed(2));

  // Apilado visual: profundo abajo (violeta oscuro) → REM → ligero arriba (claro).
  const capas = [
    { label: 'profundo', data: profundo, color: RAMPA_SUENO[2] },
    { label: 'REM', data: rem, color: RAMPA_SUENO[1] },
    { label: 'ligero', data: ligero, color: RAMPA_SUENO[0] },
  ];

  destroyChart('chartSueno'); // destruir ANTES de reusar el canvas
  const chart = new Chart($id('chartSueno'), {
    type: 'bar',
    data: {
      labels,
      datasets: capas.map((c) => ({
        label: c.label,
        data: c.data,
        backgroundColor: c.color,
        borderColor: TOKENS.card, // gap 2px entre segmentos apilados
        borderWidth: 2,
        borderSkipped: false,
        barPercentage: 0.75,
        categoryPercentage: 0.9,
        maxBarThickness: 22,
        stack: 'sueno',
      })),
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: leyenda(true),
        tooltip: tooltipBase({
          callbacks: {
            title: (items) => fmtDateEs(noches[items[0].dataIndex].date, true),
            label: (item) => (item.parsed.y > 0
              ? `${item.dataset.label}: ${item.parsed.y.toFixed(1)} h`
              : null),
            footer: (items) => {
              const d = noches[items[0].dataIndex];
              const partes = [`total: ${d.sleep_hours.toFixed(1)} h`];
              if (Number.isFinite(d.sleep_score)) partes.push(`score ${d.sleep_score}`);
              const hora = horaFmt(d.bedtime);
              if (hora) partes.push(`te acostaste a las ${hora}`);
              return partes.join(' · ');
            },
          },
        }),
      },
      scales: {
        x: ejeX({ stacked: true }),
        y: ejeY({
          stacked: true,
          beginAtZero: true,
          suggestedMax: 9,
          ticks: { callback: (v) => `${v} h` },
        }),
      },
    },
  });
  registerChart('chartSueno', chart);
}

/* ==========================================================================
   5.2 · HRV nocturno — banda baseline + etiqueta directa (RANGO) — spec §5-5.2
   ========================================================================== */

export function renderHrv(ctx) {
  const card = $id('cardHrv');
  if (!card) return;
  const dias = ctx.fDaily;
  const valores = dias.map((d) => (Number.isFinite(d.hrv) ? d.hrv : null));
  if (!valores.some(Number.isFinite)) {
    emptyState(card, 'Sin HRV en este rango · prueba 90d');
    return;
  }
  clearEmptyState(card);

  const labels = dias.map((d) => fmtDateEs(d.date));
  const bl = ctx.data.status && ctx.data.status.hrv_baseline;
  const desde = bl && Number.isFinite(bl.balancedLow) ? bl.balancedLow : null;
  const hasta = bl && Number.isFinite(bl.balancedUpper) ? bl.balancedUpper : null;

  const plugins = [makeUltimoValorPlugin((v) => `${v} ms`)];
  if (desde !== null && hasta !== null) {
    // Banda gris translúcida = referencia, no estado (spec §5-5.2).
    plugins.unshift(makeBandPlugin({ from: desde, to: hasta, label: `baseline ${desde}–${hasta}` }));
  }

  destroyChart('chartHrv'); // destruir ANTES de reusar el canvas
  const chart = new Chart($id('chartHrv'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'HRV',
        data: valores,
        borderColor: SERIES.s2,
        backgroundColor: SERIES.s2,
        borderWidth: 2,
        pointRadius: 3, // puntos ≥3px (§3)
        pointHitRadius: 8,
        spanGaps: true,
        tension: 0.25,
      }],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { right: 44 } }, // hueco para la etiqueta del último valor
      plugins: {
        legend: leyenda(false), // 1 serie
        tooltip: tooltipBase({
          callbacks: {
            label: (item) => `HRV: ${item.parsed.y} ms`,
            footer: (items) => {
              const d = dias[items[0].dataIndex];
              return typeof d.hrv_status === 'string' && d.hrv_status
                ? `estado Garmin: ${d.hrv_status.toLowerCase()}` : '';
            },
          },
        }),
      },
      scales: {
        x: ejeX(),
        y: ejeY({ suggestedMin: 40, suggestedMax: 100, ticks: { callback: (v) => `${v}` } }),
      },
    },
    plugins,
  });
  registerChart('chartHrv', chart);
}
