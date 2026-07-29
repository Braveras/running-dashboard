/* ==========================================================================
   helpers.js — utilidades puras + constantes de paleta (§2 del spec).
   Sin dependencias de DOM salvo emptyState/clearEmptyState (reciben el nodo).
   ========================================================================== */

/* ---------- Constantes de paleta (hex validados 2026-07-23) ---------- */

/** Tokens de superficie y texto (§2.1). */
export const TOKENS = {
  bg: '#0e1116',
  card: '#161b24',
  card2: '#1c2330',
  border: '#232b3a',
  grid: 'rgba(35, 43, 58, 0.5)', // --grid al 50%: grid recesivo solo horizontal
  txt: '#e8edf4',
  muted: '#94a0b3',
};

/** Series categóricas (§2.2) — orden FIJO, nunca cicladas. */
export const SERIES = {
  s1: '#3987e5', // azul: volumen, ritmo, desacople, scatter, sparklines
  s2: '#199e70', // verde-aqua: EF Z2 (protagonista), HRV, medias móviles de S1
  s3: '#9085e9', // violeta: FC, sueño, «otra actividad» en heatmap
  s4: '#d55181', // magenta: cadencia
};

/** Estado (§2.3) — RESERVADO: solo semáforo/umbrales/badges/flechas, con icono+texto. */
export const ESTADO = {
  verde: '#4dd0a6',
  ambar: '#f6a35b',
  rojo: '#ef6b6b',
};

/** Rampa zonas FC, 5 pasos Z1 claro → Z5 oscuro (§2.4). Solo para la gráfica de zonas. */
export const RAMPA_ZONAS = ['#b7d3f6', '#86b6ef', '#5598e7', '#2f7bd9', '#1e60b0'];

/** Rampa heatmap, 4 pasos poco km (oscuro) → mucho km (claro) (§2.4). Celda vacía: TOKENS.card2. */
export const RAMPA_HEATMAP = ['#1e60b0', '#2f7bd9', '#5598e7', '#9ec4f2'];

/** Rampa fases de sueño (§2.4): [ligero, REM, profundo]. */
export const RAMPA_SUENO = ['#b9b0f4', '#9085e9', '#6b5fd0'];

/** Meses abreviados en español, índice 0 = enero. */
export const MONTH_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Fuente monospace para cifras dentro de canvas (ticks, etiquetas). */
export const FONT_MONO = "ui-monospace, 'Cascadia Mono', 'SF Mono', Consolas, monospace";
export const FONT_UI = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif";

/* ---------- Formato ---------- */

/**
 * Segundos por km → «m:ss». REDONDEA EL TOTAL PRIMERO: jamás «6:60».
 * paceFmt(419.6) → '7:00'. Devuelve '–' si no es finito o ≤0.
 */
export function paceFmt(secPerKm) {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return '–';
  const total = Math.round(secPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Segundos → duración estilo reloj: 'mm:ss' o 'h:mm:ss' si ≥1 h.
 * fmtDur(2049) → '34:09'. Redondea el total primero.
 */
export function fmtDur(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '–';
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Segundos → duración legible larga: '5 h 42 min' o '34 min'.
 * Para el tile «Tiempo total del rango».
 */
export function fmtDurLargo(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '–';
  const totalMin = Math.round(sec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  return `${m} min`;
}

/**
 * ISO 'YYYY-MM-DD' → '12 mar' (conAnio=false) o '12 mar 26' (conAnio=true).
 * Por SLICING, sin new Date(): inmune a husos horarios.
 */
export function fmtDateEs(iso, conAnio = false) {
  if (typeof iso !== 'string' || iso.length < 10) return '–';
  const d = parseInt(iso.slice(8, 10), 10);
  const m = parseInt(iso.slice(5, 7), 10) - 1;
  const base = `${d} ${MONTH_ES[m] || '?'}`;
  return conAnio ? `${base} ${iso.slice(2, 4)}` : base;
}

/* ---------- Fechas (aritmética en UTC, formato por slicing) ---------- */

/** ISO 'YYYY-MM-DD' + delta días → ISO. Aritmética en UTC (sin huso). */
export function isoAddDays(iso, delta) {
  const t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + delta * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Fecha local de hoy como ISO 'YYYY-MM-DD'. */
export function isoToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * ISO 'YYYY-MM-DD' → clave de semana ISO-8601 'YYYY-Www' (p.ej. '2026-W30').
 * El año es el AÑO ISO (puede diferir del natural en los bordes). Cálculo en UTC.
 */
export function isoWeekKey(iso) {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  const day = (d.getUTCDay() + 6) % 7;            // lunes=0 … domingo=6
  d.setUTCDate(d.getUTCDate() - day + 3);          // jueves de esa semana
  const isoYear = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const week = 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/* ---------- Estadística ---------- */

/**
 * Media móvil simple de ventana n. Devuelve array de la MISMA longitud:
 * out[i] = media de los valores válidos (finitos) en values[max(0,i-n+1)..i];
 * ventanas parciales al inicio se calculan con lo disponible; si no hay
 * ningún valor válido en la ventana → null.
 */
export function movingAvg(values, n) {
  return values.map((_, i) => {
    const win = values.slice(Math.max(0, i - n + 1), i + 1).filter(Number.isFinite);
    if (!win.length) return null;
    return win.reduce((a, b) => a + b, 0) / win.length;
  });
}

/**
 * Media móvil exponencial (alpha ∈ (0,1], por defecto 0.3).
 * Entrada null/no finita → emite null y NO actualiza la EMA.
 * Devuelve array de la misma longitud.
 */
export function expMovingAvg(values, alpha = 0.3) {
  let ema = null;
  return values.map((v) => {
    if (!Number.isFinite(v)) return null;
    ema = ema === null ? v : alpha * v + (1 - alpha) * ema;
    return ema;
  });
}

/**
 * Regresión lineal simple sobre pares finitos.
 * @returns {{slope:number, intercept:number, r:number, r2:number, n:number}|null}
 *          null si hay <2 pares válidos o varianza X nula.
 */
export function linreg(xs, ys) {
  const px = [], py = [];
  for (let i = 0; i < xs.length; i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) { px.push(xs[i]); py.push(ys[i]); }
  }
  const n = px.length;
  if (n < 2) return null;
  const mx = px.reduce((a, b) => a + b, 0) / n;
  const my = py.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = px[i] - mx, dy = py[i] - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r = syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
  return { slope, intercept, r, r2: r * r, n };
}

/* ---------- Plugin Chart.js: banda/línea horizontal ---------- */

let bandCounter = 0;

/**
 * Plugin de Chart.js que pinta, ANTES de los datasets, una banda horizontal
 * translúcida y/o una línea horizontal discontinua con etiqueta de texto.
 * ÚNICO para HRV (banda 51–91), cadencia (banda 160–165) y FC (línea 142).
 *
 * @param {object} opts
 * @param {number} [opts.from]  límite inferior de la banda (unidades de datos)
 * @param {number} [opts.to]    límite superior de la banda
 * @param {number} [opts.y]     valor de una línea horizontal discontinua
 * @param {string} [opts.color]      relleno de banda (por defecto gris 10%)
 * @param {string} [opts.lineColor]  color de la línea (por defecto muted)
 * @param {number[]} [opts.dash]     patrón de guiones, por defecto [6,4]
 * @param {string} [opts.label]      texto (11px mono) alineado a la derecha
 * @param {string} [opts.labelColor] color del texto (por defecto muted)
 * @param {string} [opts.scaleID]    escala Y, por defecto 'y'
 * @returns {object} plugin para pasar en `plugins: [ ... ]` del chart
 */
export function makeBandPlugin({
  from = null,
  to = null,
  y = null,
  color = 'rgba(148, 160, 179, 0.10)',
  lineColor = TOKENS.muted,
  dash = [6, 4],
  label = '',
  labelColor = TOKENS.muted,
  scaleID = 'y',
} = {}) {
  return {
    id: `bandPlugin${bandCounter++}`,
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const sc = scales[scaleID];
      if (!sc || !chartArea) return;
      ctx.save();
      if (from !== null && to !== null) {
        const y1 = sc.getPixelForValue(from);
        const y2 = sc.getPixelForValue(to);
        ctx.fillStyle = color;
        ctx.fillRect(chartArea.left, Math.min(y1, y2), chartArea.right - chartArea.left, Math.abs(y2 - y1));
      }
      if (y !== null) {
        const yy = sc.getPixelForValue(y);
        ctx.strokeStyle = lineColor;
        ctx.setLineDash(dash);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(chartArea.left, yy);
        ctx.lineTo(chartArea.right, yy);
        ctx.stroke();
      }
      if (label) {
        const yRef = y !== null ? sc.getPixelForValue(y) : sc.getPixelForValue(to ?? from);
        ctx.fillStyle = labelColor;
        ctx.font = `11px ${FONT_MONO}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(label, chartArea.right - 4, yRef - 3);
      }
      ctx.restore();
    },
  };
}

/* ---------- Estados vacíos ---------- */

/** Selectores de contenido que emptyState oculta dentro de una card.
 *  OJO: .explorer-controls queda FUERA a propósito — si el scatter cae en
 *  vacío («prueba otra combinación de ejes»), los selects X/Y deben seguir
 *  visibles para poder salir de ahí. */
const EMPTY_HIDE_SELECTOR = '.chart-wrap, .table-wrap, .tiles-grid, .heatmap-container, .pr-list, .predicciones, .pager, .zonas-layout';

/**
 * Muestra un estado vacío en una card: oculta su contenido de datos
 * (con [hidden], nunca display:none inline) y pinta un mensaje.
 * @param {HTMLElement} cardEl nodo .card
 * @param {string} msg p.ej. 'Sin carreras en este rango · prueba 90d'
 * @returns {HTMLElement} el div.empty-state
 */
export function emptyState(cardEl, msg) {
  cardEl.querySelectorAll(EMPTY_HIDE_SELECTOR).forEach((el) => { el.hidden = true; });
  let es = cardEl.querySelector('.empty-state');
  if (!es) {
    es = document.createElement('div');
    es.className = 'empty-state';
    cardEl.appendChild(es);
  }
  es.textContent = msg;
  es.hidden = false;
  return es;
}

/**
 * Revierte emptyState: reexpone el contenido de datos y oculta el mensaje.
 * Llamar SIEMPRE al principio de un re-render que sí tiene datos.
 */
export function clearEmptyState(cardEl) {
  cardEl.querySelectorAll(EMPTY_HIDE_SELECTOR).forEach((el) => { el.hidden = false; });
  const es = cardEl.querySelector('.empty-state');
  if (es) es.hidden = true;
}
