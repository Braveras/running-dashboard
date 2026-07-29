/* ==========================================================================
   today.js — ACTO 1 «Hoy» (semáforo hero + bullet bars + ACWR)
              y ACTO 2 «Esta semana» (stat-tiles con sparklines).
   Contrato: INTERFACES.md §4.1. Colores SOLO de helpers.js.
   ========================================================================== */

import {
  TOKENS, ESTADO, SERIES,
  fmtDurLargo, fmtDateEs,
  isoAddDays, isoToday, isoWeekKey,
  expMovingAvg, emptyState, clearEmptyState,
} from './helpers.js';
import { sparklineSvg } from './sparkline.js';

/* ---------- Utilidades locales ---------- */

/** Días entre dos ISO 'YYYY-MM-DD' (b − a), aritmética UTC. */
function diasEntre(a, b) {
  const t = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86400000);
}

/** Lunes (ISO) de la semana a la que pertenece la fecha. */
function isoLunes(iso) {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  const dow = (d.getUTCDay() + 6) % 7; // lunes=0 … domingo=6
  return isoAddDays(iso, -dow);
}

/** Número con coma decimal española. fmtNum(3.65) → '3,7'. */
function fmtNum(v, dec = 1) {
  if (!Number.isFinite(v)) return '–';
  return v.toFixed(dec).replace('.', ',');
}

/** Crea un elemento con clase y texto opcionales. */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/**
 * Fecha de referencia de los datos: la de meta.updated si existe
 * (coherente con state.filterByRange), si no la fecha local de hoy.
 */
function fechaRef(data) {
  if (data && data.meta && typeof data.meta.updated === 'string') {
    return data.meta.updated.slice(0, 10);
  }
  return isoToday();
}

/* ---------- ACWR propio (km/día de runs.json, EMA 7d vs 28d) ---------- */

/**
 * ACWR propio: serie km/día (0 en días sin carrera) desde la primera carrera
 * hasta la fecha de referencia; carga aguda = EMA de constante ~7 días
 * (alpha = 2/(7+1)) y crónica = EMA ~28 días (alpha = 2/(28+1)).
 * Con 1–7 km/semana es volátil (riesgo §10.2): por eso se acompaña SIEMPRE
 * de la doble lectura con el ratio Garmin en #acwrNota.
 * @returns {number|null} ratio aguda/crónica, o null si no es computable.
 */
function acwrPropio(runs, refIso) {
  if (!Array.isArray(runs) || !runs.length) return null;
  const kmPorDia = new Map();
  for (const r of runs) {
    if (Number.isFinite(r.km)) kmPorDia.set(r.date, (kmPorDia.get(r.date) || 0) + r.km);
  }
  const primera = runs[0].date; // runs ya viene ordenado asc
  if (!(primera <= refIso)) return null;
  const dias = [];
  for (let d = primera; d <= refIso && dias.length < 1000; d = isoAddDays(d, 1)) {
    dias.push(kmPorDia.get(d) || 0);
  }
  if (dias.length < 14) return null; // muestra insuficiente para el ratio
  const aguda = expMovingAvg(dias, 2 / (7 + 1));
  const cronica = expMovingAvg(dias, 2 / (28 + 1));
  const a = aguda[aguda.length - 1];
  const c = cronica[cronica.length - 1];
  if (!Number.isFinite(a) || !Number.isFinite(c) || c <= 0) return null;
  return a / c;
}

/** Etiqueta cualitativa del ACWR (bandas <0.8 / 0.8–1.3 / >1.5). */
function acwrEtiqueta(v) {
  if (!Number.isFinite(v)) return '–';
  if (v < 0.8) return 'carga muy baja';
  if (v <= 1.3) return 'zona óptima';
  if (v <= 1.5) return 'carga alta';
  return 'riesgo elevado';
}

/* ---------- Bullet bar SVG (inline, sin Chart.js) ---------- */

const NS = 'http://www.w3.org/2000/svg';

/**
 * Bullet bar horizontal: pista + banda de referencia gris translúcida +
 * ticks etiquetados (11px mono, muted) + marcador vertical en tinta.
 * El estado NUNCA colorea la barra (§2.3): la banda es referencia.
 *
 * @param {object} o
 * @param {number} o.min dominio inferior
 * @param {number} o.max dominio superior
 * @param {number|null} o.value valor del marcador (null → sin marcador)
 * @param {{from:number, to:number}} [o.band] banda de referencia
 * @param {{v:number, label:string}[]} [o.ticks] marcas etiquetadas
 * @returns {SVGSVGElement}
 */
function bulletSvg({ min, max, value, band = null, ticks = [] }) {
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

  rect(PAD, barY, W - 2 * PAD, barH, TOKENS.card2, 6);                 // pista
  if (band) rect(x(band.from), barY, x(band.to) - x(band.from), barH, 'rgba(148, 160, 179, 0.22)', 3); // referencia

  for (const t of ticks) {                                             // ticks etiquetados
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
    texto.setAttribute('font-family', "ui-monospace, 'Cascadia Mono', 'SF Mono', Consolas, monospace");
    texto.setAttribute('fill', TOKENS.muted);
    texto.textContent = t.label;
    svg.appendChild(texto);
  }

  if (Number.isFinite(value)) {                                        // marcador en tinta
    rect(x(value) - 1.5, barY - 4, 3, barH + 8, TOKENS.txt, 1.5);
  }
  return svg;
}

/** Rellena un contenedor .bullet: etiqueta (nombre + valor) + bullet bar. */
function pintaBullet(cont, nombre, valorTxt, svgOpts) {
  cont.textContent = '';
  const label = el('div', 'bullet-label');
  label.appendChild(el('span', null, nombre));
  const strong = document.createElement('strong');
  strong.textContent = valorTxt;
  label.appendChild(strong);
  cont.appendChild(label);
  cont.appendChild(bulletSvg(svgOpts));
}

/* ==========================================================================
   1.1 SEMÁFORO HERO
   ========================================================================== */

/**
 * Semáforo de «¿corro hoy?» — lógica EXACTA del spec §5-1.1:
 *
 *  (1) FRESCURA: si el último día de daily.json NO es hoy → razón
 *      «datos de hace N días» y el estado se degrada como mínimo a ÁMBAR
 *      (nunca damos verde con datos viejos).
 *  (2) HRV: último `daily.hrv` frente a la banda
 *      status.hrv_baseline.balancedLow–balancedUpper (51–91):
 *      por DEBAJO de balancedLow → penaliza (ámbar). Dentro → razón positiva.
 *  (3) SUEÑO: sleep_score < 60 o sleep_hours < 5 → penaliza (ámbar).
 *      (Umbrales v1 documentados como supuesto; el spec pide «bajos».)
 *  (4) PARTY: daily.party === true → ámbar; ROJO solo si ADEMÁS
 *      hrv < balancedLow (única vía al rojo en v1).
 *  (5) ACWR < 0.8 REFUERZA el verde con la razón «carga muy baja: hoy toca
 *      salir» — añade motivo, pero NO anula penalizaciones (2)-(4).
 *      Se usa el ratio Garmin acute_load/chronic_load (hoy 35/137 ≈ 0.26);
 *      si falta, el ACWR propio por km.
 *  (6) BODY BATTERY: daily.json NO trae nivel absoluto (solo bb_charged /
 *      bb_drained — verificado). Regla v1: balance charged−drained del DÍA
 *      PREVIO ≤ −20 → ámbar, etiquetado «balance Body Battery». El nivel
 *      absoluto exigiría exportarlo en fetch_data.py (fase 3): no se inventa.
 *
 * Estado gris .estado-neutro solo mientras carga (lo pone el HTML);
 * esta función siempre lo sustituye por verde/ámbar/rojo.
 * Card exenta del rango: usa ctx.data, ignora ctx.fRuns/fDaily.
 */
export function renderSemaforo(ctx) {
  const card = document.getElementById('cardSemaforo');
  if (!card) return;
  const { daily, status, runs } = ctx.data || {};

  if (!Array.isArray(daily) && !status) {
    emptyState(card, 'Sin datos de recuperación ni de carga · revisa daily.json y status.json');
    return;
  }
  clearEmptyState(card);

  const hoy = isoToday();
  const ref = fechaRef(ctx.data);
  const ultimo = Array.isArray(daily) && daily.length ? daily[daily.length - 1] : null;

  // --- Lecturas ---
  // HRV: la del último día; si es null, la última lectura de hasta 3 días atrás.
  let hrv = null;
  if (Array.isArray(daily)) {
    for (let i = daily.length - 1; i >= 0 && i >= daily.length - 4; i--) {
      if (Number.isFinite(daily[i].hrv)) { hrv = daily[i].hrv; break; }
    }
  }
  const banda = status && status.hrv_baseline ? status.hrv_baseline : null;
  const bLow = banda && Number.isFinite(banda.balancedLow) ? banda.balancedLow : null;
  const bUp = banda && Number.isFinite(banda.balancedUpper) ? banda.balancedUpper : null;

  // Balance Body Battery del día previo (fila con date = ayer; si no, la penúltima).
  let bbBalance = null;
  if (Array.isArray(daily) && daily.length) {
    const ayer = isoAddDays(ultimo && ultimo.date === hoy ? hoy : (ultimo ? ultimo.date : hoy), -1);
    const fila = daily.find((d) => d.date === ayer) ||
      (daily.length > 1 ? daily[daily.length - 2] : null);
    if (fila && Number.isFinite(fila.bb_charged) && Number.isFinite(fila.bb_drained)) {
      bbBalance = fila.bb_charged - fila.bb_drained;
    }
  }

  // ACWR: propio (km/día) para el bullet + ratio Garmin como doble lectura.
  const acwrKm = acwrPropio(runs, ref);
  const ratioGarmin = status && Number.isFinite(status.acute_load) &&
    Number.isFinite(status.chronic_load) && status.chronic_load > 0
    ? status.acute_load / status.chronic_load : null;
  const acwrRegla = ratioGarmin !== null ? ratioGarmin : acwrKm; // para la regla (5)

  // --- Evaluación (0 = verde, 1 = ámbar, 2 = rojo) ---
  let nivel = 0;
  const razones = [];

  // (1) Frescura
  if (!ultimo) {
    nivel = Math.max(nivel, 1);
    razones.push('Sin datos diarios recientes (daily.json vacío o caído).');
  } else if (ultimo.date !== hoy) {
    const n = Math.max(diasEntre(ultimo.date, hoy), 1);
    nivel = Math.max(nivel, 1);
    razones.push(`Datos de hace ${n} ${n === 1 ? 'día' : 'días'} — sincroniza el reloj antes de fiarte del verde.`);
  }

  // (2) HRV vs banda
  if (Number.isFinite(hrv) && bLow !== null && bUp !== null) {
    if (hrv < bLow) {
      nivel = Math.max(nivel, 1);
      razones.push(`HRV ${hrv} ms por debajo de tu banda ${bLow}–${bUp}: recuperación incompleta.`);
    } else if (hrv > bUp) {
      razones.push(`HRV ${hrv} ms por encima de la banda ${bLow}–${bUp} (dato atípico, sin penalizar).`);
    } else {
      razones.push(`HRV ${hrv} ms dentro de tu banda ${bLow}–${bUp}.`);
    }
  } else {
    razones.push('Sin lectura de HRV reciente.');
  }

  // (3) Sueño
  if (ultimo && (Number.isFinite(ultimo.sleep_score) || Number.isFinite(ultimo.sleep_hours))) {
    const scoreBajo = Number.isFinite(ultimo.sleep_score) && ultimo.sleep_score < 60;
    const horasBajas = Number.isFinite(ultimo.sleep_hours) && ultimo.sleep_hours < 5;
    const desc = `${Number.isFinite(ultimo.sleep_hours) ? `${fmtNum(ultimo.sleep_hours)} h` : 's/d'}` +
      `${Number.isFinite(ultimo.sleep_score) ? ` · score ${ultimo.sleep_score}` : ''}`;
    if (scoreBajo || horasBajas) {
      nivel = Math.max(nivel, 1);
      razones.push(`Sueño escaso anoche (${desc}): baja la exigencia.`);
    } else {
      razones.push(`Sueño suficiente anoche (${desc}).`);
    }
  }

  // (4) Party
  if (ultimo && ultimo.party === true) {
    if (Number.isFinite(hrv) && bLow !== null && hrv < bLow) {
      nivel = 2;
      razones.push('Noche de fiesta + HRV por debajo de la banda: hoy toca descanso.');
    } else {
      nivel = Math.max(nivel, 1);
      razones.push('Noche de fiesta: si sales, que sea corto y muy suave.');
    }
  }

  // (5) ACWR bajo refuerza el verde
  if (Number.isFinite(acwrRegla) && acwrRegla < 0.8) {
    razones.push(`Carga muy baja (ACWR ${fmtNum(acwrRegla, 2)}): hoy toca salir.`);
  }

  // (6) Balance Body Battery del día previo
  if (Number.isFinite(bbBalance) && bbBalance <= -20) {
    nivel = Math.max(nivel, 1);
    razones.push(`Balance Body Battery de ayer muy negativo (${fmtNum(bbBalance, 0)}): llegas con déficit.`);
  }

  // --- Pintado del estado ---
  const estados = [
    { clase: 'estado-verde', icono: '✓', nombre: 'verde', msg: 'Sal a correr — Z2 suave' },
    { clase: 'estado-ambar', icono: '!', nombre: 'ámbar', msg: 'Sal con cabeza — acorta o suaviza' },
    { clase: 'estado-rojo', icono: '✕', nombre: 'rojo', msg: 'Hoy toca descanso' },
  ];
  const e = estados[nivel];
  card.classList.remove('estado-neutro', 'estado-verde', 'estado-ambar', 'estado-rojo');
  card.classList.add(e.clase);
  document.getElementById('semaforoIcono').textContent = e.icono;
  document.getElementById('semaforoMensaje').textContent = e.msg;
  document.getElementById('semaforoSr').textContent = `Semáforo: ${e.nombre}`;

  const ul = document.getElementById('semaforoRazones');
  ul.textContent = '';
  for (const r of razones) ul.appendChild(el('li', null, r));

  // --- Bullet bars (SVG inline, §5-1.1 derecha) ---
  const bHrv = document.getElementById('bulletHrv');
  if (bHrv) {
    const lo = bLow !== null ? bLow : 51;
    const up = bUp !== null ? bUp : 91;
    pintaBullet(bHrv, 'HRV nocturno', Number.isFinite(hrv) ? `${hrv} ms` : '–', {
      min: Math.min(30, Number.isFinite(hrv) ? hrv - 5 : 30),
      max: Math.max(110, Number.isFinite(hrv) ? hrv + 5 : 110),
      value: Number.isFinite(hrv) ? hrv : null,
      band: { from: lo, to: up },
      ticks: [{ v: lo, label: String(lo) }, { v: up, label: String(up) }],
    });
  }

  const bBB = document.getElementById('bulletBB');
  if (bBB) {
    pintaBullet(bBB, 'Balance Body Battery (ayer)',
      Number.isFinite(bbBalance) ? (bbBalance > 0 ? `+${bbBalance}` : String(bbBalance)) : '–', {
        min: Math.min(-60, Number.isFinite(bbBalance) ? bbBalance - 5 : -60),
        max: Math.max(60, Number.isFinite(bbBalance) ? bbBalance + 5 : 60),
        value: Number.isFinite(bbBalance) ? bbBalance : null,
        band: { from: 0, to: Math.max(60, Number.isFinite(bbBalance) ? bbBalance + 5 : 60) },
        ticks: [{ v: -20, label: '−20' }, { v: 0, label: '0' }],
      });
  }

  const bAcwr = document.getElementById('bulletAcwr');
  if (bAcwr) {
    pintaBullet(bAcwr, 'ACWR (km propios)',
      Number.isFinite(acwrKm) ? fmtNum(acwrKm, 2) : '–', {
        min: 0,
        max: Math.max(2, Number.isFinite(acwrKm) ? acwrKm + 0.2 : 2),
        value: Number.isFinite(acwrKm) ? acwrKm : null,
        band: { from: 0.8, to: 1.3 },
        ticks: [
          { v: 0.8, label: '0,8' },
          { v: 1.3, label: '1,3' },
          { v: 1.5, label: '1,5' },
        ],
      });
  }

  // Doble lectura textual del ACWR con el ratio Garmin (riesgo §10.2).
  const nota = document.getElementById('acwrNota');
  if (nota) {
    if (ratioGarmin !== null) {
      nota.textContent = `Doble lectura — ratio Garmin ${fmtNum(status.acute_load, 0)}/${fmtNum(status.chronic_load, 0)} ≈ ${fmtNum(ratioGarmin, 2)} · ${acwrEtiqueta(ratioGarmin)}`;
    } else if (Number.isFinite(acwrKm)) {
      nota.textContent = `ACWR propio ${fmtNum(acwrKm, 2)} · ${acwrEtiqueta(acwrKm)} (sin ratio Garmin disponible)`;
    } else {
      nota.textContent = 'ACWR no computable todavía: hacen falta al menos dos semanas de carreras.';
    }
  }
}

/* ==========================================================================
   2.1 STAT-TILES CON SPARKLINES
   ========================================================================== */

/** Agrega runs por semana ISO consecutiva (incluye semanas a 0). */
function semanasConsecutivas(runs, refIso) {
  const kmPorSemana = new Map();
  const carrerasPorSemana = new Map();
  for (const r of runs) {
    const k = isoWeekKey(r.date);
    kmPorSemana.set(k, (kmPorSemana.get(k) || 0) + (Number.isFinite(r.km) ? r.km : 0));
    carrerasPorSemana.set(k, (carrerasPorSemana.get(k) || 0) + 1);
  }
  const semanas = []; // [{key, km, carreras}] en orden cronológico, sin huecos
  let lunes = isoLunes(runs[0].date);
  const lunesRef = isoLunes(refIso);
  for (let i = 0; lunes <= lunesRef && i < 500; i++, lunes = isoAddDays(lunes, 7)) {
    const k = isoWeekKey(lunes);
    semanas.push({ key: k, km: kmPorSemana.get(k) || 0, carreras: carrerasPorSemana.get(k) || 0 });
  }
  return semanas;
}

/** Construye un tile estándar. spark: number[]|null · delta: {txt, cls}|null. */
function tile({ label, valorHtml, delta, spark, placeholder = false }) {
  const t = el('div', placeholder ? 'tile tile--placeholder' : 'tile');
  const head = el('div', 'tile-head');
  const mark = el('span', 'tile-mark');
  mark.style.background = SERIES.s1; // marca de color de serie (8px)
  head.appendChild(mark);
  head.appendChild(el('span', null, label));
  t.appendChild(head);

  const val = el('div', 'tile-value');
  val.append(...valorHtml); // nodos ya construidos (nunca innerHTML con datos)
  t.appendChild(val);

  if (delta) t.appendChild(el('div', `tile-delta${delta.cls ? ` ${delta.cls}` : ''}`, delta.txt));

  if (spark && spark.filter(Number.isFinite).length >= 2) {
    const wrap = el('div', 'tile-spark');
    wrap.appendChild(sparklineSvg(spark));
    t.appendChild(wrap);
  }
  return t;
}

/** Nodos [cifra, <small>unidad</small>] para .tile-value. */
function valorConUnidad(cifra, unidad) {
  const nodos = [document.createTextNode(cifra)];
  if (unidad) {
    const s = document.createElement('small');
    s.textContent = ` ${unidad}`;
    nodos.push(s);
  }
  return nodos;
}

/**
 * 5 stat-tiles (§5-2.1): km semana ISO, racha real, carreras/4 sem,
 * tiempo total del rango (único dependiente del rango) y peso.
 * Re-ejecutable: vacía #statTiles y reconstruye.
 */
export function renderStatTiles(ctx) {
  const card = document.getElementById('cardTiles');
  const cont = document.getElementById('statTiles');
  if (!card || !cont) return;
  const { runs, daily } = ctx.data || {};

  if (!Array.isArray(runs) || !runs.length) {
    emptyState(card, 'Sin carreras registradas todavía · los tiles aparecerán con la primera');
    return;
  }
  clearEmptyState(card);
  cont.textContent = '';

  const ref = fechaRef(ctx.data);
  const semanas = semanasConsecutivas(runs, ref); // cronológico, sin huecos
  const idxActual = semanas.length - 1;
  const semActual = semanas[idxActual];

  // --- Tile 1 · Km esta semana (ISO en curso) + delta vs media 4 sem previas ---
  const previas = semanas.slice(Math.max(0, idxActual - 4), idxActual);
  const media4 = previas.length
    ? previas.reduce((a, s) => a + s.km, 0) / previas.length : null;
  let delta1 = null;
  if (media4 !== null && media4 > 0) {
    const pct = ((semActual.km - media4) / media4) * 100;
    const sube = pct >= 0;
    delta1 = {
      txt: `${sube ? '▲' : '▼'} ${sube ? '+' : '−'}${fmtNum(Math.abs(pct), 0)} % vs media 4 sem`,
      cls: sube ? 'delta-mejor' : 'delta-peor', // más volumen = mejor (base Z2)
    };
  } else {
    delta1 = { txt: 'sin base de comparación aún', cls: '' };
  }
  cont.appendChild(tile({
    label: 'Km esta semana',
    valorHtml: valorConUnidad(fmtNum(semActual.km, 1), 'km'),
    delta: delta1,
    spark: semanas.slice(-12).map((s) => s.km),
  }));

  // --- Tile 2 · Racha real: semanas ISO consecutivas con ≥1 carrera.
  // La semana en curso sin carrera aún NO rompe la racha (está a medias). ---
  let racha = 0;
  let i = idxActual;
  if (semanas[i] && semanas[i].carreras === 0) i--; // perdona la semana en curso
  for (; i >= 0 && semanas[i].carreras > 0; i--) racha++;
  cont.appendChild(tile({
    label: 'Racha',
    valorHtml: valorConUnidad(String(racha), racha === 1 ? 'semana' : 'semanas'),
    delta: { txt: 'semanas seguidas con ≥1 carrera', cls: '' },
    spark: semanas.slice(-12).map((s) => s.carreras),
  }));

  // --- Tile 3 · Carreras / 4 sem (últimos 28 días) + delta vs 28 días previos ---
  const corte28 = isoAddDays(ref, -27);
  const corte56 = isoAddDays(ref, -55);
  const n28 = runs.filter((r) => r.date >= corte28).length;
  const nPrev28 = runs.filter((r) => r.date >= corte56 && r.date < corte28).length;
  const dif3 = n28 - nPrev28;
  cont.appendChild(tile({
    label: 'Carreras / 4 sem',
    valorHtml: valorConUnidad(String(n28), ''),
    delta: dif3 === 0
      ? { txt: '= igual que las 4 sem previas', cls: '' }
      : {
          txt: `${dif3 > 0 ? '▲ +' : '▼ −'}${Math.abs(dif3)} vs 4 sem previas`,
          cls: dif3 > 0 ? 'delta-mejor' : 'delta-peor',
        },
    spark: semanas.slice(-12).map((s) => s.carreras),
  }));

  // --- Tile 4 · Tiempo total del rango (ÚNICO tile que respeta el rango) ---
  const totalS = ctx.fRuns.reduce((a, r) => a + (Number.isFinite(r.dur_s) ? r.dur_s : 0), 0);
  const rangoTxt = ctx.range === 'all' ? 'todo' : `${ctx.range}d`;
  cont.appendChild(tile({
    label: `Tiempo total · ${rangoTxt}`,
    valorHtml: valorConUnidad(fmtDurLargo(totalS), ''),
    delta: { txt: `${ctx.fRuns.length} ${ctx.fRuns.length === 1 ? 'carrera' : 'carreras'} en el rango`, cls: '' },
    spark: ctx.fRuns.map((r) => (Number.isFinite(r.dur_s) ? r.dur_s / 60 : null)),
  }));

  // --- Tile 5 · Peso: último pesaje + delta vs anterior; placeholder si el
  // último dato tiene >30 días (NUNCA se oculta el tile — spec §5-2.1). ---
  const pesajes = Array.isArray(daily)
    ? daily.filter((d) => Number.isFinite(d.weight_kg)) : [];
  if (!pesajes.length) {
    cont.appendChild(tile({
      label: 'Peso',
      valorHtml: valorConUnidad('–', ''),
      delta: { txt: 'sin pesajes registrados', cls: '' },
      spark: null,
      placeholder: true,
    }));
  } else {
    const ultimoPeso = pesajes[pesajes.length - 1];
    const anterior = pesajes.length > 1 ? pesajes[pesajes.length - 2] : null;
    const reciente = diasEntre(ultimoPeso.date, ref) <= 30;
    let deltaPeso = { txt: `último: ${fmtDateEs(ultimoPeso.date)}`, cls: '' };
    if (anterior) {
      const dif = ultimoPeso.weight_kg - anterior.weight_kg;
      // Supuesto v1: bajar peso = mejor (tendencia buscada 88 → 83.7 kg).
      deltaPeso = {
        txt: `${dif <= 0 ? '▼ −' : '▲ +'}${fmtNum(Math.abs(dif), 1)} kg vs anterior · ${fmtDateEs(ultimoPeso.date)}`,
        cls: dif <= 0 ? 'delta-mejor' : 'delta-peor',
      };
    }
    if (!reciente) deltaPeso.txt += ' · sin pesajes recientes';
    cont.appendChild(tile({
      label: 'Peso',
      valorHtml: valorConUnidad(fmtNum(ultimoPeso.weight_kg, 1), 'kg'),
      delta: deltaPeso,
      spark: pesajes.length >= 2 ? pesajes.map((p) => p.weight_kg) : null,
      placeholder: !reciente,
    }));
  }
}
