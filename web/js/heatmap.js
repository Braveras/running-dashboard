/* ==========================================================================
   heatmap.js — Calendario de actividad SVG propio (Acto 6 · 6.1 del spec).
   Sin Chart.js: columnas = semanas (lunes arriba), filas = L-D, celdas 16×16.
   - Km de carrera/día → rampa azul RAMPA_HEATMAP en 4 cuartiles (poco→mucho).
   - Día sin actividad → TOKENS.card2.
   - Otras actividades (fuerza/caminata) → ROMBO violeta S3: la FORMA es la
     codificación primaria (CVD-safe), el color acompaña.
   - Tooltip propio tap-friendly, tabindex+Enter/Espacio, click → modal si es
     carrera (guard if (!run) return). Últimos 12 meses + paginación por año.
   ========================================================================== */

import {
  TOKENS, SERIES, RAMPA_HEATMAP, MONTH_ES, FONT_UI, FONT_MONO,
  paceFmt, fmtDur, fmtDateEs, isoAddDays, isoToday,
  emptyState, clearEmptyState,
} from './helpers.js';
import { openRunModal } from './modal.js';

/* ---------- Constantes de dibujo ---------- */

const CELDA = 16;              // lado de la celda (px)
const HUECO = 3;               // separación entre celdas
const RADIO = 3;               // radio de esquinas del rect
const PASO = CELDA + HUECO;
const PAD_IZQ = 30;            // hueco para etiquetas de fila L/X/V
const PAD_SUP = 20;            // hueco para etiquetas de mes
const SVG_NS = 'http://www.w3.org/2000/svg';

const TIPO_ES = { strength_training: 'fuerza', walking: 'caminata' };

/* ---------- Estado del módulo (para re-render y paginación) ---------- */

let porDia = new Map();        // iso → { km, run, otras: [{type, dur_s}] }
let umbrales = [0, 0, 0];      // cuartiles Q1/Q2/Q3 de km/día (histórico completo)
let refISO = null;             // fecha de referencia («hoy» de los datos)
let primeraISO = null;         // primer día con histórico
let paginaActual = '12m';      // '12m' | año (number)

/* ---------- Utilidades de fecha (slicing + UTC, coherente con helpers) ---------- */

/** Día de la semana con lunes=0 … domingo=6 (cálculo en UTC, sin huso). */
function diaSemanaLunes0(iso) {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  return (d.getUTCDay() + 6) % 7;
}

/** Primer día del mes situado n meses antes del mes de `iso`. */
function inicioMesMenos(iso, n) {
  let y = +iso.slice(0, 4);
  let m = +iso.slice(5, 7) - 1 - n;
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/* ---------- Utilidades SVG / DOM ---------- */

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** Tooltip único compartido, colgado del body (evita el clipping del overflow-x). */
function obtenerTip() {
  let tip = document.querySelector('.heatmap-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'heatmap-tip';
    tip.hidden = true;
    document.body.appendChild(tip);
  }
  return tip;
}

/* ---------- Preparación de datos ---------- */

/** Cuartil p (0–1) de un array YA ordenado ascendente. */
function cuantil(ordenados, p) {
  if (!ordenados.length) return 0;
  return ordenados[Math.min(ordenados.length - 1, Math.floor(p * (ordenados.length - 1)))];
}

/** Índice 0–3 en la rampa (poco→mucho km) según cuartiles del histórico. */
function indiceRampa(km) {
  if (km <= umbrales[0]) return 0;
  if (km <= umbrales[1]) return 1;
  if (km <= umbrales[2]) return 2;
  return 3;
}

/** Texto del día para tooltip y aria-label (una línea por actividad). */
function textoDia(iso) {
  const info = porDia.get(iso);
  const lineas = [fmtDateEs(iso, true)];
  if (!info) {
    lineas.push('sin actividad');
    return lineas;
  }
  if (info.run) {
    let l = `carrera: ${info.km.toFixed(2)} km`;
    if (Number.isFinite(info.run.pace_s)) l += ` · ${paceFmt(info.run.pace_s)}/km`;
    if (Number.isFinite(info.run.hr)) l += ` · FC ${Math.round(info.run.hr)}`;
    lineas.push(l);
  }
  for (const o of info.otras) {
    const tipo = TIPO_ES[o.type] || o.type;
    lineas.push(`${tipo}: ${fmtDur(o.dur_s)}`);
  }
  if (info.run) lineas.push('Enter o click: ver detalle');
  return lineas;
}

/* ---------- Ventanas de paginación ---------- */

/**
 * Ventana [desde, hasta] de la página activa.
 * '12m' = últimos 12 meses naturales hasta la referencia; año = ese año natural.
 * Ambas se recortan al histórico real (nada de meses vacíos engañosos).
 */
function ventanaDePagina(pagina) {
  const primerMes = `${primeraISO.slice(0, 7)}-01`;
  if (pagina === '12m') {
    const desde = inicioMesMenos(refISO, 11);
    return { desde: desde > primerMes ? desde : primerMes, hasta: refISO };
  }
  const desde = `${pagina}-01-01` > primerMes ? `${pagina}-01-01` : primerMes;
  const hasta = `${pagina}-12-31` < refISO ? `${pagina}-12-31` : refISO;
  return { desde, hasta };
}

/* ---------- Dibujo del grid ---------- */

function dibujarGrid(container) {
  const { desde, hasta } = ventanaDePagina(paginaActual);
  container.innerHTML = '';

  // Rejilla: empezamos en el lunes anterior (o igual) a `desde`.
  const inicioRejilla = isoAddDays(desde, -diaSemanaLunes0(desde));
  const totalDias = Math.round(
    (Date.UTC(+hasta.slice(0, 4), +hasta.slice(5, 7) - 1, +hasta.slice(8, 10))
      - Date.UTC(+inicioRejilla.slice(0, 4), +inicioRejilla.slice(5, 7) - 1, +inicioRejilla.slice(8, 10))) / 86400000,
  ) + 1;
  const nSemanas = Math.ceil(totalDias / 7);

  const ancho = PAD_IZQ + nSemanas * PASO;
  const alto = PAD_SUP + 7 * PASO;
  const svg = svgEl('svg', {
    width: ancho,
    height: alto,
    viewBox: `0 0 ${ancho} ${alto}`,
    role: 'img', // sin role, el aria-label de un SVG puede no anunciarse
    'aria-label': `Calendario de actividad del ${fmtDateEs(desde, true)} al ${fmtDateEs(hasta, true)}`,
  });

  // Etiquetas de fila L / X / V (lunes, miércoles, viernes).
  for (const [fila, letra] of [[0, 'L'], [2, 'X'], [4, 'V']]) {
    const t = svgEl('text', {
      x: PAD_IZQ - 8,
      y: PAD_SUP + fila * PASO + CELDA / 2,
      fill: TOKENS.muted,
      'text-anchor': 'end',
      'dominant-baseline': 'central',
      style: `font: 11px ${FONT_UI};`,
    });
    t.textContent = letra;
    svg.appendChild(t);
  }

  // Celdas + etiquetas de mes (cuando cambia el mes del lunes de la columna).
  let mesPrevio = '';
  let primeraEtiqueta = true;
  for (let s = 0; s < nSemanas; s++) {
    const lunes = isoAddDays(inicioRejilla, s * 7);
    const mesLunes = lunes.slice(0, 7);
    if (mesLunes !== mesPrevio && lunes >= desde) {
      const m = +lunes.slice(5, 7) - 1;
      // El año solo en la primera etiqueta y en cada enero (a prueba de 2027).
      const conAnio = primeraEtiqueta || m === 0;
      const t = svgEl('text', {
        x: PAD_IZQ + s * PASO,
        y: PAD_SUP - 7,
        fill: TOKENS.muted,
        style: `font: 11px ${FONT_MONO};`, // labels mínimos 11px (§3)
      });
      t.textContent = conAnio ? `${MONTH_ES[m]} ${lunes.slice(2, 4)}` : MONTH_ES[m];
      svg.appendChild(t);
      mesPrevio = mesLunes;
      primeraEtiqueta = false;
    }

    for (let fila = 0; fila < 7; fila++) {
      const iso = isoAddDays(inicioRejilla, s * 7 + fila);
      if (iso < desde || iso > hasta) continue; // fuera de la ventana: no se pinta

      const info = porDia.get(iso);
      const x = PAD_IZQ + s * PASO;
      const y = PAD_SUP + fila * PASO;

      const rect = svgEl('rect', {
        x, y,
        width: CELDA,
        height: CELDA,
        rx: RADIO,
        fill: info && info.km > 0 ? RAMPA_HEATMAP[indiceRampa(info.km)] : TOKENS.card2,
        'data-date': iso,
      });

      if (info) {
        // Celdas con actividad: focusables (tooltip por teclado) y etiquetadas.
        rect.setAttribute('tabindex', '0');
        rect.setAttribute('aria-label', textoDia(iso).join(' · '));
        rect.style.cursor = info.run ? 'pointer' : 'default';
        if (info.run) {
          rect.setAttribute('role', 'button');
          rect.setAttribute('data-run-id', String(info.run.id));
        } else {
          // Solo fuerza/caminata: sin role, el aria-label del <rect> puede
          // no anunciarse en lectores de pantalla.
          rect.setAttribute('role', 'img');
        }
      }
      svg.appendChild(rect);

      // Rombo violeta = otra actividad (la forma es la codificación primaria).
      if (info && info.otras.length) {
        const cx = x + CELDA / 2;
        const cy = y + CELDA / 2;
        const r = 5;
        const rombo = svgEl('path', {
          d: `M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z`,
          fill: SERIES.s3,
          stroke: TOKENS.card,
          'stroke-width': '1',
          'pointer-events': 'none', // los eventos los recibe la celda de debajo
        });
        svg.appendChild(rombo);
      }
    }
  }

  cablearEventos(svg);
  container.appendChild(svg);
}

/* ---------- Interacción (delegada en el propio SVG) ---------- */

function mostrarTip(rect) {
  const tip = obtenerTip();
  tip.textContent = '';
  for (const linea of textoDia(rect.getAttribute('data-date'))) {
    const div = document.createElement('div');
    div.textContent = linea;
    tip.appendChild(div);
  }
  tip.hidden = false;
  const caja = rect.getBoundingClientRect();
  let left = window.scrollX + caja.left + caja.width / 2 - tip.offsetWidth / 2;
  left = Math.max(8, Math.min(left, window.scrollX + document.documentElement.clientWidth - tip.offsetWidth - 8));
  let top = window.scrollY + caja.top - tip.offsetHeight - 8;
  if (top < window.scrollY + 4) top = window.scrollY + caja.bottom + 8; // sin sitio arriba → debajo
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function ocultarTip() {
  const tip = document.querySelector('.heatmap-tip');
  if (tip) tip.hidden = true;
}

/** Abre el modal de la carrera de esa celda. GUARD obligatorio: sin carrera → return. */
function abrirCarrera(rect) {
  const info = porDia.get(rect.getAttribute('data-date'));
  const run = info && info.run;
  if (!run) return; // guard: solo las celdas con carrera abren modal
  ocultarTip();
  openRunModal(run.id);
}

function cablearEventos(svg) {
  const esCelda = (t) => t instanceof Element && t.hasAttribute('data-date');

  svg.addEventListener('mouseover', (e) => { if (esCelda(e.target)) mostrarTip(e.target); });
  svg.addEventListener('mouseout', (e) => { if (esCelda(e.target)) ocultarTip(); });

  svg.addEventListener('focusin', (e) => {
    if (!esCelda(e.target)) return;
    e.target.setAttribute('stroke', TOKENS.txt);       // anillo de foco visible
    e.target.setAttribute('stroke-width', '1.5');
    mostrarTip(e.target);
  });
  svg.addEventListener('focusout', (e) => {
    if (!esCelda(e.target)) return;
    e.target.removeAttribute('stroke');
    e.target.removeAttribute('stroke-width');
    ocultarTip();
  });

  // Tap/click: en carrera abre el modal; en el resto ya hay tooltip por focus.
  svg.addEventListener('click', (e) => { if (esCelda(e.target)) abrirCarrera(e.target); });
  svg.addEventListener('keydown', (e) => {
    if (!esCelda(e.target)) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      abrirCarrera(e.target);
    }
  });
}

/* ---------- Paginación por año ---------- */

function dibujarPager(pager, container) {
  pager.innerHTML = '';
  const inicio12m = ventanaDePagina('12m').desde;
  if (primeraISO >= inicio12m) return; // todo el histórico cabe en 12 meses: sin pager

  const paginas = [{ id: '12m', etiqueta: 'Últimos 12 meses' }];
  for (let y = +refISO.slice(0, 4); y >= +primeraISO.slice(0, 4); y--) {
    paginas.push({ id: y, etiqueta: String(y) });
  }
  for (const p of paginas) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = p.etiqueta;
    btn.setAttribute('aria-pressed', String(p.id === paginaActual));
    btn.addEventListener('click', () => {
      if (p.id === paginaActual) return;
      paginaActual = p.id;
      pager.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      dibujarGrid(container);
    });
    pager.appendChild(btn);
  }
}

/* ---------- Contador de fuerza del mes ---------- */

function pintarKpiFuerza(el, otras) {
  const mesRef = refISO.slice(0, 7);
  const n = otras.filter((a) => a.type === 'strength_training' && String(a.date).slice(0, 7) === mesRef).length;
  el.textContent = '';
  const strong = document.createElement('strong');
  strong.textContent = String(n);
  el.appendChild(strong);
  el.appendChild(document.createTextNode(` ${n === 1 ? 'sesión' : 'sesiones'} de fuerza este mes`));
}

/* ---------- Render principal (contrato INTERFACES §4.4) ---------- */

/**
 * Calendario de actividad — card #cardHeatmap (HISTÓRICO, exenta del rango).
 * Re-ejecutable: reconstruye estado, pager y grid en cada llamada.
 */
export function renderHeatmap(ctx) {
  const card = document.getElementById('cardHeatmap');
  const container = document.getElementById('heatmapContainer');
  const pager = document.getElementById('heatmapPager');
  const kpi = document.getElementById('kpiFuerza');
  if (!card || !container || !pager || !kpi) return;

  const runs = Array.isArray(ctx.data.runs) ? ctx.data.runs : [];
  const otras = (Array.isArray(ctx.data.allActivities) ? ctx.data.allActivities : [])
    .filter((a) => a && a.type !== 'running' && typeof a.date === 'string');

  if (!runs.length && !otras.length) {
    kpi.textContent = '';
    emptyState(card, 'Sin actividades registradas todavía — el calendario se rellenará con tus salidas.');
    return;
  }
  clearEmptyState(card);

  // Índice por día: km totales, carrera representativa (la más larga) y otras.
  porDia = new Map();
  const dia = (iso) => {
    let d = porDia.get(iso);
    if (!d) { d = { km: 0, run: null, otras: [] }; porDia.set(iso, d); }
    return d;
  };
  for (const r of runs) {
    if (typeof r.date !== 'string') continue;
    const d = dia(r.date);
    d.km += Number.isFinite(r.km) ? r.km : 0;
    if (!d.run || (Number.isFinite(r.km) && r.km > (d.run.km || 0))) d.run = r;
  }
  for (const a of otras) dia(a.date).otras.push(a);

  // Cuartiles de km/día sobre TODO el histórico (card exenta del rango).
  const kms = [...porDia.values()].map((d) => d.km).filter((k) => k > 0).sort((a, b) => a - b);
  umbrales = [cuantil(kms, 0.25), cuantil(kms, 0.5), cuantil(kms, 0.75)];

  // Referencia temporal: fecha de meta.updated; fallback: último dato; último: hoy.
  const fechas = [...porDia.keys()].sort();
  refISO = (ctx.data.meta && typeof ctx.data.meta.updated === 'string' && ctx.data.meta.updated.slice(0, 10))
    || fechas[fechas.length - 1] || isoToday();
  primeraISO = (ctx.data.meta && typeof ctx.data.meta.first_date === 'string' && ctx.data.meta.first_date)
    || fechas[0] || refISO;

  paginaActual = '12m';
  dibujarPager(pager, container);
  dibujarGrid(container);
  pintarKpiFuerza(kpi, otras);
}
