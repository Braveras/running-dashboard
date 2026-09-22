/* ==========================================================================
   today.js — pestaña HOY (§2.1 semáforo hero + adición Garmin · §2.2 desglose
              de readiness · §2.3 constantes de hoy) y los stat-tiles de
              Entrenar (§2.4, el tile de peso emigró a Cuerpo).
   Contrato: INTERFACES.md §4.1. Colores SOLO de helpers.js.
   ========================================================================== */

import {
  TOKENS, ESTADO, SERIES, FONT_MONO,
  NIVEL_READINESS, QUALIFIER_ESTRES, FEEDBACK_FACTOR, FEEDBACK_READINESS,
  fmtDurLargo,
  isoAddDays, isoToday, isoWeekKey,
  expMovingAvg, percentileRank, emptyState, clearEmptyState,
} from './helpers.js';
import { sparklineSvg } from './sparkline.js';
import { registerChart, destroyChart } from './state.js';
import { kpiAcuerdo } from './insights.js';

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

/** Entero con separador de miles español. fmtInt(10234) → '10.234'. */
function fmtInt(v) {
  if (!Number.isFinite(v)) return '–';
  return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Crea un elemento con clase y texto opcionales. */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** Fila de health.json de una fecha exacta (o null). health viene asc. */
function filaSalud(health, iso) {
  if (!Array.isArray(health)) return null;
  for (let i = health.length - 1; i >= 0; i--) {
    if (health[i] && health[i].date === iso) return health[i];
    if (health[i] && health[i].date < iso) break; // orden asc: ya no está
  }
  return null;
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
 *  (6) BODY BATTERY balance: charged−drained del DÍA PREVIO ≤ −20 → ámbar.
 *  (6b) BODY BATTERY nivel (fase 3): bb_high del día más reciente = pico tras
 *      la carga nocturna ≈ reserva al despertar; < 40 → ámbar. Sin bb_high
 *      (despliegue sin regenerar datos) la regla es inerte.
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
  // Fase 3: si esa misma fila trae el nivel ABSOLUTO (bb_last, o bb_high si no
  // hay last), lo usamos como lectura principal. Claves ausentes o null
  // (despliegues sin regenerar) → bbNivel queda null y todo sigue como antes.
  let bbBalance = null;
  let bbNivel = null;
  if (Array.isArray(daily) && daily.length) {
    const ayer = isoAddDays(ultimo && ultimo.date === hoy ? hoy : (ultimo ? ultimo.date : hoy), -1);
    const fila = daily.find((d) => d.date === ayer) ||
      (daily.length > 1 ? daily[daily.length - 2] : null);
    if (fila && Number.isFinite(fila.bb_charged) && Number.isFinite(fila.bb_drained)) {
      bbBalance = fila.bb_charged - fila.bb_drained;
    }
  }
  // Nivel ABSOLUTO (fase 3): bb_high de la fila MÁS RECIENTE = pico tras la
  // carga nocturna ≈ reserva al despertar. Nunca bb_last (a fin de día es el
  // nivel de irse a dormir: bajo siempre, dispararía ámbar a diario).
  if (ultimo && Number.isFinite(ultimo.bb_high)) bbNivel = ultimo.bb_high;

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

  // (6b) Fase 3 — nivel absoluto de Body Battery: <40 al despertar → ámbar.
  // Solo aplica si el pipeline ya exporta bb_last/bb_high; sin nivel, nada cambia.
  if (bbNivel !== null && bbNivel < 40) {
    nivel = Math.max(nivel, 1);
    razones.push(`Body Battery bajo (pico de hoy ${bbNivel}): la noche no ha recargado.`);
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
    if (bbNivel !== null) {
      // Fase 3: nivel absoluto 0–100 con banda de referencia 40–70.
      pintaBullet(bBB, 'Body Battery (pico de hoy)', String(bbNivel), {
        min: 0,
        max: 100,
        value: bbNivel,
        band: { from: 40, to: 70 },
        ticks: [{ v: 40, label: '40' }, { v: 70, label: '70' }],
      });
    } else {
      pintaBullet(bBB, 'Balance Body Battery (ayer)',
        Number.isFinite(bbBalance) ? (bbBalance > 0 ? `+${bbBalance}` : String(bbBalance)) : '–', {
          min: Math.min(-60, Number.isFinite(bbBalance) ? bbBalance - 5 : -60),
          max: Math.max(60, Number.isFinite(bbBalance) ? bbBalance + 5 : 60),
          value: Number.isFinite(bbBalance) ? bbBalance : null,
          band: { from: 0, to: Math.max(60, Number.isFinite(bbBalance) ? bbBalance + 5 : 60) },
          ticks: [{ v: -20, label: '−20' }, { v: 0, label: '0' }],
        });
    }
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
    // §2.1: el bullet de ACWR gana la lectura Garmin textual del factor de
    // carga («Garmin: carga al 100 %», acwr_pct del día de referencia).
    const filaHoy = filaSalud(ctx.data ? ctx.data.health : null, ref);
    if (filaHoy && Number.isFinite(filaHoy.acwr_pct)) {
      nota.textContent += ` · Garmin: carga al ${fmtNum(filaHoy.acwr_pct, 0)} %`;
    }
    pintaTendenciaRatio(nota, ctx.data ? ctx.data.statusHistory : null);
  }

  // §2.1: segunda opinión Garmin ETIQUETADA (jamás fusionada con el semáforo)
  // + KPI de acuerdo histórico. La lógica del semáforo de arriba NO se toca.
  pintaGarminOpina(ctx.data ? ctx.data.health : null, ref);
  pintaKpiAcuerdo(ctx.data || {});
}

/* ---------- §2.1 · Adición Garmin al semáforo ---------- */

/**
 * Línea «Garmin opina: readiness 58 · moderado — buena recuperación» en
 * #garminOpina, desde la fila de health.json de la fecha de referencia.
 * - Fila de hoy con `readiness_score` → score + level traducido
 *   (NIVEL_READINESS; level no mapeado → se omite, jamás la constante cruda)
 *   + feedbackShort por diccionario PARCIAL (FEEDBACK_READINESS; no mapeado →
 *   «recuperación correcta»; sin feedback → se omite el tramo).
 * - health.json existe pero sin score de hoy (sin sync matinal) → texto exacto
 *   «Garmin aún no ha puntuado hoy» (y no se declara acuerdo ni desacuerdo).
 * - Sin health.json → #garminOpina queda vacío (la card no degrada por esto).
 */
function pintaGarminOpina(health, refIso) {
  const p = document.getElementById('garminOpina');
  if (!p) return;
  p.textContent = '';
  if (!Array.isArray(health) || !health.length) return;
  const fila = filaSalud(health, refIso);
  if (!fila || !Number.isFinite(fila.readiness_score)) {
    p.appendChild(el('strong', null, 'Garmin aún no ha puntuado hoy'));
    return;
  }
  const nivel = typeof fila.readiness_level === 'string'
    ? (NIVEL_READINESS[fila.readiness_level] || '') : '';
  let texto = '';
  if (nivel) texto += ` · ${nivel}`;
  if (typeof fila.readiness_feedback === 'string' && fila.readiness_feedback) {
    texto += ` — ${FEEDBACK_READINESS[fila.readiness_feedback] || 'recuperación correcta'}`;
  }
  p.appendChild(el('strong', null, 'Garmin opina:'));
  p.appendChild(document.createTextNode(' readiness '));
  // Cifra en <strong class="mono"> — mono tabular (§3); el strong de la
  // etiqueta «Garmin opina:» es UI y se queda en tipografía de UI.
  p.appendChild(el('strong', 'mono', fmtNum(fila.readiness_score, 0)));
  if (texto) p.appendChild(document.createTextNode(texto));
}

/**
 * KPI discreto «semáforo y Garmin coinciden N de M días» en #kpiAcuerdo
 * (§2.1). UNA sola aritmética del acuerdo: Insights.kpiAcuerdo (que replica
 * el lookback de HRV de 3 días de renderSemaforo vía veredictoPropioDia) —
 * aquí solo se PINTA su frase, con N y M en <strong> (mono tabular por CSS
 * .kpi-acuerdo strong). La guarda n≥20 vive en insights.js ('' → vacío).
 */
function pintaKpiAcuerdo(data) {
  const p = document.getElementById('kpiAcuerdo');
  if (!p) return;
  p.textContent = '';
  const frase = kpiAcuerdo(data);
  const m = typeof frase === 'string'
    ? frase.match(/^Semáforo y Garmin coinciden (\d+) de (\d+) días\.?$/) : null;
  if (!m) return; // sin guarda superada (o frase inesperada): elemento vacío
  p.appendChild(document.createTextNode('Semáforo y Garmin coinciden '));
  p.appendChild(el('strong', null, m[1]));
  p.appendChild(document.createTextNode(' de '));
  p.appendChild(el('strong', null, m[2]));
  p.appendChild(document.createTextNode(' días'));
}

/**
 * Fase 3 — tendencia del ratio Garmin desde status_history.json (1 punto/día).
 * Con ≥14 puntos con acute_load y chronic_load numéricos (chronic > 0) añade
 * bajo #acwrNota una línea «ratio Garmin: X → Y (N días)» (primer vs último
 * punto válido). Con menos puntos, fichero ausente o null → no pinta nada
 * (y retira la línea de un render anterior: re-render idempotente).
 */
function pintaTendenciaRatio(nota, statusHistory) {
  let linea = document.getElementById('acwrTendencia');
  const validos = Array.isArray(statusHistory)
    ? statusHistory.filter((p) => p && Number.isFinite(p.acute_load) &&
        Number.isFinite(p.chronic_load) && p.chronic_load > 0)
    : [];
  if (validos.length < 14) {
    if (linea) linea.remove();
    return;
  }
  const primero = validos[0].acute_load / validos[0].chronic_load;
  const ultimo = validos[validos.length - 1].acute_load / validos[validos.length - 1].chronic_load;
  if (!linea) {
    linea = el('p', 'note');
    linea.id = 'acwrTendencia';
    nota.insertAdjacentElement('afterend', linea);
  }
  linea.textContent = `ratio Garmin: ${fmtNum(primero, 2)} → ${fmtNum(ultimo, 2)} (${validos.length} días)`;
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

/** Construye un tile estándar. spark: number[]|null · delta: {txt, cls}|null ·
 *  tip: tooltip nativo (title) del tile — §2 spec salud: tooltips en todo. */
function tile({ label, valorHtml, delta, spark, placeholder = false, tip = '' }) {
  const t = el('div', placeholder ? 'tile tile--placeholder' : 'tile');
  if (tip) t.title = tip;
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
 * 4 stat-tiles (§2.4 spec salud): km semana ISO, racha real, carreras/4 sem
 * y tiempo total del rango (único dependiente del rango). El tile de peso
 * MURIÓ aquí: vive como card §2.21 en la pestaña Cuerpo.
 * Re-ejecutable: vacía #statTiles y reconstruye.
 */
export function renderStatTiles(ctx) {
  const card = document.getElementById('cardTiles');
  const cont = document.getElementById('statTiles');
  if (!card || !cont) return;
  const { runs } = ctx.data || {};

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
}

/* ==========================================================================
   §2.2 DESGLOSE DE READINESS — 6 factores de hoy, barras horizontales 0–100
   ========================================================================== */

/** Orden FIJO de los factores (§2.2): [etiqueta, clave %, clave feedback]. */
const FACTORES_READINESS = [
  ['Sueño de anoche', 'factor_sleep_pct', 'factor_sleep_fb'],
  ['Historial de sueño', 'factor_sleep_hist_pct', 'factor_sleep_hist_fb'],
  ['HRV', 'factor_hrv_pct', 'factor_hrv_fb'],
  ['Tiempo de recuperación', 'factor_recovery_pct', 'factor_recovery_fb'],
  ['Historial de estrés', 'factor_stress_pct', 'factor_stress_fb'],
  ['Carga ACWR', 'acwr_pct', 'acwr_fb'],
];

/**
 * Card #cardDesgloseReadiness (exenta del rango: usa ctx.data). Los 6 factores
 * del readiness del día MÁS RECIENTE de health.json con readiness_score no
 * null, como barras horizontales 0–100 en UNA sola serie S1 (mismo indicador,
 * no categorías): sin leyenda, % como etiqueta directa al final de cada barra
 * y feedback Garmin traducido (FEEDBACK_FACTOR) como texto muted junto a la
 * barra — JAMÁS coloreando la barra. Tooltip con el feedback de cada factor.
 * Los campos *_fb se leen defensivamente (el pipeline puede no exportarlos
 * aún): sin feedback se omite el texto, nunca se rompe ni se pinta la
 * constante cruda. Sin health.json o sin día con readiness → emptyState.
 */
export function renderDesgloseReadiness(ctx) {
  const card = document.getElementById('cardDesgloseReadiness');
  if (!card) return;
  const canvas = document.getElementById('chartDesgloseReadiness');
  const health = ctx.data ? ctx.data.health : null;

  if (!Array.isArray(health) || !health.length) {
    destroyChart('chartDesgloseReadiness'); // idempotencia también al degradar
    emptyState(card, 'Sin datos de salud todavía · el desglose aparecerá cuando el pipeline genere health.json');
    return;
  }
  let fila = null;
  for (let i = health.length - 1; i >= 0; i--) {
    if (health[i] && Number.isFinite(health[i].readiness_score)) { fila = health[i]; break; }
  }
  if (!fila || !canvas) {
    destroyChart('chartDesgloseReadiness');
    emptyState(card, 'Garmin aún no ha puntuado ningún día · el desglose aparecerá tras una sincronización matinal');
    return;
  }
  clearEmptyState(card);

  const etiquetas = [];
  const valores = [];
  const feedbacks = [];
  for (const [nombre, kPct, kFb] of FACTORES_READINESS) {
    etiquetas.push(nombre);
    valores.push(Number.isFinite(fila[kPct]) ? fila[kPct] : null);
    const codigo = typeof fila[kFb] === 'string' ? fila[kFb] : null; // defensivo
    feedbacks.push(codigo && FEEDBACK_FACTOR[codigo] ? FEEDBACK_FACTOR[codigo] : '');
  }

  // Etiqueta directa al final de cada barra: «47 %» en tinta + feedback muted.
  const etiquetasPlugin = {
    id: 'desgloseEtiquetas',
    afterDatasetsDraw(chart) {
      const g = chart.ctx;
      const meta = chart.getDatasetMeta(0);
      if (!meta || !meta.data) return;
      g.save();
      g.font = `11px ${FONT_MONO}`;
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      meta.data.forEach((barra, i) => {
        if (!Number.isFinite(valores[i]) || !barra) return;
        let xx = barra.x + 6;
        const pctTxt = `${fmtNum(valores[i], 0)} %`;
        g.fillStyle = TOKENS.txt;
        g.fillText(pctTxt, xx, barra.y);
        if (feedbacks[i]) {
          xx += g.measureText(pctTxt).width + 6;
          g.fillStyle = TOKENS.muted;
          g.fillText(`· ${feedbacks[i]}`, xx, barra.y);
        }
      });
      g.restore();
    },
  };

  // Chart.js exige destruir ANTES de reusar el canvas: registerChart destruye
  // el chart viejo DESPUÉS de evaluar su argumento, así que sin este destroy
  // el segundo render (toggle de tema, reintento) lanzaría «Canvas is already
  // in use» — mismo patrón que el resto de módulos.
  destroyChart('chartDesgloseReadiness');
  registerChart('chartDesgloseReadiness', new Chart(canvas, {
    type: 'bar',
    data: {
      labels: etiquetas,
      datasets: [{
        data: valores,
        backgroundColor: SERIES.s1,
        borderRadius: 3,
        barPercentage: 0.65,
        categoryPercentage: 0.8,
      }],
    },
    options: {
      indexAxis: 'y',
      layout: { padding: { right: 120 } }, // sitio para «100 % · muy bueno»
      // Tooltips tap-friendly (§6.2 spec base): sin esto, con barras de 12px
      // habría que acertar la barra, y un factor null no tendría tooltip.
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false }, // una sola serie: sin leyenda (§0 regla 6)
        tooltip: {
          callbacks: {
            label(item) {
              const fb = feedbacks[item.dataIndex];
              return `${fmtNum(item.parsed.x, 0)} de 100${fb ? ` · ${fb}` : ''}`;
            },
          },
        },
      },
      scales: {
        x: { suggestedMin: 0, suggestedMax: 100, grid: { drawTicks: false } },
        y: { grid: { display: false } },
      },
    },
    plugins: [etiquetasPlugin],
  }));
}

/* ==========================================================================
   §2.3 CONSTANTES DE HOY — 6 stat-tiles con sparklines de 14 días
   ========================================================================== */

/**
 * Card #cardConstantes → #constantesTiles (exenta del rango: usa ctx.data).
 * 6 tiles (reusa .tile + sparklineSvg; sparkline = últimos 14 días naturales
 * de health.json, huecos = null): ① RHR de hoy + delta vs media 7d + badge de
 * percentil personal (percentileRank sobre los últimos 90 días con dato,
 * guarda n≥60, tinta ▲▼ — jamás color de estado); ② SpO2 del sueño;
 * ③ respiración del sueño; ④ estrés medio de AYER + qualifier traducido;
 * ⑤ pasos de AYER vs objetivo dinámico; ⑥ minutos de intensidad de la semana
 * ISO en curso vs 150 OMS (el tooltip añade el ponderado mod + 2×vig).
 * Día sin dato → tile placeholder «— sin dato», NUNCA se oculta el tile.
 * Sin health.json → emptyState de la card.
 */
export function renderConstantes(ctx) {
  const card = document.getElementById('cardConstantes');
  const cont = document.getElementById('constantesTiles');
  if (!card || !cont) return;
  const health = ctx.data ? ctx.data.health : null;

  if (!Array.isArray(health) || !health.length) {
    emptyState(card, 'Sin datos de salud todavía · las constantes aparecerán cuando el pipeline genere health.json');
    return;
  }
  clearEmptyState(card);
  cont.textContent = '';

  const ref = fechaRef(ctx.data);
  const ayer = isoAddDays(ref, -1);
  const porFecha = new Map();
  for (const h of health) if (h && typeof h.date === 'string') porFecha.set(h.date, h);
  const hoyFila = porFecha.get(ref) || null;
  const ayerFila = porFecha.get(ayer) || null;

  /** Serie de los 14 días naturales que acaban en ref (huecos → null). */
  const spark14 = (campo) => {
    const out = [];
    for (let i = 13; i >= 0; i--) {
      const f = porFecha.get(isoAddDays(ref, -i));
      out.push(f && Number.isFinite(f[campo]) ? f[campo] : null);
    }
    return out;
  };

  /** Tile placeholder homogéneo: valor «—», delta literal «— sin dato». */
  const tileSinDato = (label, campo, tip) => tile({
    label,
    valorHtml: valorConUnidad('—', ''),
    delta: { txt: '— sin dato', cls: '' },
    spark: campo ? spark14(campo) : null,
    placeholder: true,
    tip,
  });

  // --- ① FC reposo hoy + delta vs media 7d + percentil personal (§5) ---
  {
    const tip = 'FC en reposo de hoy, frente a tu media de 7 días y a tus últimos 90 días';
    if (hoyFila && Number.isFinite(hoyFila.rhr)) {
      let delta = null;
      if (Number.isFinite(hoyFila.rhr_7d)) {
        const dif = hoyFila.rhr - hoyFila.rhr_7d;
        // Dirección de juicio: en RHR, bajar es mejora (§2.16/§2.23).
        delta = dif === 0
          ? { txt: '= igual que tu media 7d', cls: '' }
          : {
              txt: `${dif < 0 ? '▼ −' : '▲ +'}${fmtNum(Math.abs(dif), 0)} lpm vs media 7d`,
              cls: dif < 0 ? 'delta-mejor' : 'delta-peor',
            };
      }
      const t = tile({
        label: 'FC reposo · hoy',
        valorHtml: valorConUnidad(fmtNum(hoyFila.rhr, 0), 'lpm'),
        delta,
        spark: spark14('rhr'),
        tip,
      });
      // Badge de percentil personal: ventana móvil de 90 días CON dato,
      // guarda n≥60 (métrica diaria) o no se pinta. Tinta, sin color de estado.
      const corte90 = isoAddDays(ref, -89);
      const ventana = health
        .filter((h) => h && h.date >= corte90 && h.date <= ref)
        .map((h) => h.rhr);
      const pr = percentileRank(ventana, hoyFila.rhr);
      if (pr && pr.n >= 60) {
        const flecha = pr.pct >= 50 ? '▲' : '▼';
        t.insertBefore(
          el('div', 'tile-delta', `${flecha} p${Math.round(pr.pct)} de tus últimos 90 días`),
          t.querySelector('.tile-spark'), // null → append al final
        );
      }
      cont.appendChild(t);
    } else {
      cont.appendChild(tileSinDato('FC reposo · hoy', 'rhr', tip));
    }
  }

  // --- ② SpO2 media del sueño ---
  {
    const tip = 'SpO2 media del sueño de anoche · pulsioximetría de muñeca, orientativa';
    if (hoyFila && Number.isFinite(hoyFila.spo2_sleep)) {
      cont.appendChild(tile({
        label: 'SpO2 del sueño',
        valorHtml: valorConUnidad(fmtNum(hoyFila.spo2_sleep, 0), '%'),
        delta: { txt: 'media del sueño de anoche', cls: '' },
        spark: spark14('spo2_sleep'),
        tip,
      }));
    } else {
      cont.appendChild(tileSinDato('SpO2 del sueño', 'spo2_sleep', tip));
    }
  }

  // --- ③ Respiración del sueño ---
  {
    const tip = 'Respiraciones por minuto durante el sueño de anoche';
    if (hoyFila && Number.isFinite(hoyFila.resp_sleep)) {
      cont.appendChild(tile({
        label: 'Respiración del sueño',
        valorHtml: valorConUnidad(fmtNum(hoyFila.resp_sleep, 1), 'rpm'),
        delta: { txt: 'media del sueño de anoche', cls: '' },
        spark: spark14('resp_sleep'),
        tip,
      }));
    } else {
      cont.appendChild(tileSinDato('Respiración del sueño', 'resp_sleep', tip));
    }
  }

  // --- ④ Estrés medio de ayer + qualifier traducido ---
  {
    const tip = 'Estrés medio de ayer · escala Garmin 0–100, estimación propietaria';
    if (ayerFila && Number.isFinite(ayerFila.stress_avg)) {
      const q = typeof ayerFila.stress_qualifier === 'string' && ayerFila.stress_qualifier
        ? (QUALIFIER_ESTRES[ayerFila.stress_qualifier] || 'sin calificar')
        : null; // sin qualifier: se omite, jamás la constante cruda
      cont.appendChild(tile({
        label: 'Estrés medio · ayer',
        valorHtml: valorConUnidad(fmtNum(ayerFila.stress_avg, 0), ''),
        delta: { txt: q ? `${q} · ayer` : 'ayer', cls: '' },
        spark: spark14('stress_avg'),
        tip,
      }));
    } else {
      cont.appendChild(tileSinDato('Estrés medio · ayer', 'stress_avg', tip));
    }
  }

  // --- ⑤ Pasos de ayer vs objetivo dinámico ---
  {
    const tip = 'Pasos de ayer frente al objetivo dinámico de Garmin (cambia a diario)';
    if (ayerFila && Number.isFinite(ayerFila.steps)) {
      const objetivo = Number.isFinite(ayerFila.step_goal) ? ayerFila.step_goal : null;
      cont.appendChild(tile({
        label: 'Pasos · ayer',
        valorHtml: valorConUnidad(fmtInt(ayerFila.steps), ''),
        delta: {
          txt: objetivo !== null ? `objetivo (dinámico): ${fmtInt(objetivo)}` : 'sin objetivo registrado',
          cls: '',
        },
        spark: spark14('steps'),
        tip,
      }));
    } else {
      cont.appendChild(tileSinDato('Pasos · ayer', 'steps', tip));
    }
  }

  // --- ⑥ Minutos de intensidad de la semana ISO en curso vs 150 OMS ---
  {
    const semana = isoWeekKey(ref);
    let mod = 0, vig = 0, hayDato = false;
    for (const h of health) {
      if (!h || typeof h.date !== 'string' || h.date > ref) continue;
      if (isoWeekKey(h.date) !== semana) continue;
      if (Number.isFinite(h.intensity_mod)) { mod += h.intensity_mod; hayDato = true; }
      if (Number.isFinite(h.intensity_vig)) { vig += h.intensity_vig; hayDato = true; }
    }
    const ponderado = mod + 2 * vig; // así cuentan Garmin y la OMS
    const tip = `Minutos de intensidad de la semana en curso · ponderado OMS (moderados + 2×vigorosos): ${fmtNum(ponderado, 0)} de 150`;
    const sparkInt = [];
    for (let i = 13; i >= 0; i--) {
      const f = porFecha.get(isoAddDays(ref, -i));
      sparkInt.push(f && (Number.isFinite(f.intensity_mod) || Number.isFinite(f.intensity_vig))
        ? (Number.isFinite(f.intensity_mod) ? f.intensity_mod : 0) +
          (Number.isFinite(f.intensity_vig) ? f.intensity_vig : 0)
        : null);
    }
    if (hayDato) {
      cont.appendChild(tile({
        label: 'Min intensidad · semana',
        valorHtml: valorConUnidad(fmtNum(mod + vig, 0), 'min'),
        delta: { txt: 'de 150 min/sem · recomendación OMS', cls: '' },
        spark: sparkInt,
        tip,
      }));
    } else {
      cont.appendChild(tileSinDato('Min intensidad · semana', 'intensity_mod', tip));
    }
  }
}
