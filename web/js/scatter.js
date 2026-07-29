/* ==========================================================================
   scatter.js — Correlaciones destacadas + explorador de correlaciones (§5-6.2).

   - renderCorrelaciones(ctx): 3 tiles precalculados (top |r| con n≥15 +
     la anti-intuición del sueño); click → configura el explorador y scrollea.
   - initExplorador(ctx): selects X/Y sincronizados, preset bedtime→EF,
     scatter Chart.js con línea de tendencia, R² con etiqueta cualitativa,
     aviso de muestra pequeña (n<20) y estados vacíos explicativos.

   Reglas: colores SOLO de helpers.js · pace_s SIEMPRE con paceFmt (ejes,
   tooltips) y eje invertido · sin min/max fijos · grid solo horizontal.
   ========================================================================== */

import {
  SERIES, TOKENS, FONT_MONO,
  paceFmt, fmtDateEs, linreg,
  emptyState, clearEmptyState,
} from './helpers.js';
import { registerChart, destroyChart } from './state.js';

/* ---------- Catálogo de métricas (campos exactos de runs.json) ---------- */

/** Entero como texto ('–' si no finito). */
const entero = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '–');

/** Horas decimales → 'HH:MM' (1.65 → '01:39'). Acepta valores ≥24 (eje continuo). */
function horaFmt(v) {
  if (!Number.isFinite(v)) return '–';
  const h24 = ((v % 24) + 24) % 24;
  let h = Math.floor(h24);
  let m = Math.round((h24 - h) * 60);
  if (m === 60) { m = 0; h = (h + 1) % 24; }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Métricas del explorador. Por campo:
 * - label:  etiqueta de select / eje / tooltip.
 * - frase:  forma con artículo para las frases de los tiles.
 * - fmt:    valor → texto (tooltips, siempre sobre el valor ORIGINAL).
 * - tick:   formateador de ticks del eje (si difiere del numérico crudo).
 * - transform: valor → número para el eje/correlación (solo bedtime: las
 *   horas <12 se llevan a +24 para que 23:50 y 00:10 queden contiguas en
 *   un eje «tarde→madrugada» continuo; se muestra siempre mod 24).
 * - pace:   true → eje invertido (más rápido arriba) y paceFmt obligatorio.
 */
/** Tick numérico sin artefactos de coma flotante (0.9000000000000001 → 0.9). */
const tickNum = (v) => (typeof v === 'number' ? parseFloat(v.toPrecision(4)) : v);

const METRICAS = {
  hrv_morning:      { label: 'HRV matinal (ms)',           frase: 'tu HRV matinal',        fmt: entero },
  sleep_score_prev: { label: 'score de sueño (víspera)',   frase: 'el score de sueño',     fmt: entero },
  sleep_hours_prev: { label: 'horas de sueño (víspera)',   frase: 'las horas de sueño',    fmt: (v) => (Number.isFinite(v) ? `${v.toFixed(1)} h` : '–') },
  rem_pct_prev:     { label: '% REM (víspera)',            frase: 'el % de REM',           fmt: (v) => (Number.isFinite(v) ? `${v.toFixed(1)} %` : '–') },
  bedtime_prev:     { label: 'hora de acostarse (víspera)', frase: 'la hora de acostarse', fmt: horaFmt, tick: horaFmt, transform: (v) => (v < 12 ? v + 24 : v) },
  temp_c:           { label: 'temperatura (°C)',           frase: 'la temperatura',        fmt: (v) => (Number.isFinite(v) ? `${v.toFixed(1)} °C` : '–') },
  start_hour:       { label: 'hora de salida',             frase: 'la hora de salida',     fmt: horaFmt, tick: horaFmt },
  km:               { label: 'distancia (km)',             frase: 'la distancia',          fmt: (v) => (Number.isFinite(v) ? `${v.toFixed(2)} km` : '–') },
  ef:               { label: 'eficiencia aeróbica (EF)',   frase: 'eficiencia',            fmt: (v) => (Number.isFinite(v) ? v.toFixed(2) : '–') },
  pace_s:           { label: 'ritmo (min/km)',             frase: 'ritmo',                 fmt: paceFmt, tick: paceFmt, pace: true },
  hr:               { label: 'FC media (ppm)',             frase: 'la FC media',           fmt: entero },
  cadence:          { label: 'cadencia (spm)',             frase: 'la cadencia',           fmt: entero },
};

/** Ejes X candidatos (condiciones previas / contexto) y Y (resultado de la carrera). */
const CAMPOS_X = ['hrv_morning', 'sleep_score_prev', 'sleep_hours_prev', 'rem_pct_prev', 'bedtime_prev', 'temp_c', 'start_hour', 'km'];
const CAMPOS_Y = ['ef', 'pace_s', 'hr', 'cadence'];

/** Mínimo de pares para publicar una correlación en los tiles (§6.2). */
const N_MIN_CORR = 15;
/** Por debajo de esto, el explorador avisa «muestra pequeña, orientativo». */
const N_AVISO = 20;
/** Par de la anti-intuición del sueño (vacuna contra conclusiones espurias). */
const PAR_ANTI = { cx: 'sleep_score_prev', cy: 'ef' };

/* ---------- Estado interno del explorador ---------- */

const estado = { x: 'hrv_morning', y: 'ef' };
let runsRef = null;        // referencia a data.runs (histórico completo)
let inicializado = false;  // selects poblados y listeners puestos

/* ---------- Utilidades ---------- */

const $ = (id) => document.getElementById(id);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Construye los pares (x,y) finitos de un par de campos sobre las carreras.
 * Devuelve puntos con el valor transformado para el eje y el crudo para tooltip.
 */
function construirPares(runs, cx, cy) {
  const mx = METRICAS[cx];
  const puntos = [];
  for (const run of runs) {
    const rawX = run[cx];
    const rawY = run[cy];
    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) continue;
    const x = mx.transform ? mx.transform(rawX) : rawX;
    puntos.push({ x, y: rawY, rawX, date: run.date });
  }
  return puntos;
}

/**
 * Etiqueta cualitativa de la fuerza de correlación sobre |r| (§6.2 y nota
 * de la card: débil <0.3 / moderada 0.3–0.7 / fuerte >0.7).
 */
function etiquetaR(absR) {
  if (absR < 0.3) return 'débil';
  if (absR <= 0.7) return 'moderada';
  return 'fuerte';
}

/* ==========================================================================
   Explorador (#cardExplorador)
   ========================================================================== */

/** Sincroniza selects y aria-pressed del preset con el estado interno. */
function sincronizarControles() {
  const selX = $('scatterX');
  const selY = $('scatterY');
  if (selX) selX.value = estado.x;
  if (selY) selY.value = estado.y;
  const preset = $('presetBedtime');
  if (preset) {
    const activo = estado.x === 'bedtime_prev' && estado.y === 'ef';
    preset.setAttribute('aria-pressed', String(activo));
  }
}

/** Pinta (o repinta) el scatter según el estado interno. Idempotente. */
function renderScatter() {
  const card = $('cardExplorador');
  if (!card || !Array.isArray(runsRef)) return;

  const cx = estado.x;
  const cy = estado.y;
  const mx = METRICAS[cx];
  const my = METRICAS[cy];
  const info = $('scatterInfo');
  const puntos = construirPares(runsRef, cx, cy);

  // Estado vacío explicativo: qué par falta y qué probar.
  if (puntos.length < 3) {
    destroyChart('chartScatter');
    if (info) info.textContent = '';
    emptyState(card, `Sin pares suficientes: solo ${puntos.length} carrera${puntos.length === 1 ? ' tiene' : 's tienen'} a la vez «${mx.label}» y «${my.label}» · prueba otra combinación de ejes`);
    return;
  }
  clearEmptyState(card);

  const lr = linreg(puntos.map((p) => p.x), puntos.map((p) => p.y));

  // Línea de tendencia (discontinua, muted) si hay ajuste.
  const datasets = [{
    label: 'carreras',
    data: puntos,
    backgroundColor: SERIES.s1,
    pointRadius: 5,                    // ~10px de diámetro: puntos protagonistas
    pointHoverRadius: 6,
    pointHitRadius: 8,
    pointBorderColor: TOKENS.card,     // anillo 2px de color de superficie (§3)
    pointBorderWidth: 2,
  }];
  if (lr) {
    const xs = puntos.map((p) => p.x);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    datasets.push({
      label: 'tendencia',
      type: 'line',
      data: [
        { x: x0, y: lr.intercept + lr.slope * x0 },
        { x: x1, y: lr.intercept + lr.slope * x1 },
      ],
      borderColor: TOKENS.muted,
      borderDash: [6, 4],
      borderWidth: 1.5,
      pointRadius: 0,
      pointHitRadius: 0,
      fill: false,
    });
  }

  const canvas = $('chartScatter');
  canvas.setAttribute('aria-label', `Dispersión de ${mx.label} frente a ${my.label} en ${puntos.length} carreras`);

  destroyChart('chartScatter'); // Chart.js exige destruir ANTES de reusar el canvas
  const chart = new Chart(canvas, {
    type: 'scatter',
    data: { datasets },
    options: {
      scales: {
        x: {
          type: 'linear',
          grid: { display: false },          // grid solo horizontal (§3)
          border: { display: false },
          title: { display: true, text: mx.label, color: TOKENS.muted, font: { size: 11 } },
          ticks: {
            font: { family: FONT_MONO },     // cifras en monospace (§3)
            callback: (v) => (mx.tick ? mx.tick(v) : tickNum(v)),
          },
        },
        y: {
          type: 'linear',
          reverse: !!my.pace,                // ritmo: más rápido arriba
          border: { display: false },
          title: { display: true, text: my.label, color: TOKENS.muted, font: { size: 11 } },
          ticks: {
            font: { family: FONT_MONO },
            callback: (v) => (my.tick ? my.tick(v) : tickNum(v)),
          },
        },
      },
      plugins: {
        // Una sola serie REAL ('carreras'): la tendencia es referencia, no serie
        // → sin leyenda (§10), igual que renderEF la excluye de la suya.
        legend: { display: false },
        tooltip: {
          mode: 'nearest',
          intersect: false,                  // tap-friendly
          filter: (item) => item.datasetIndex === 0, // la tendencia no «habla»
          callbacks: {
            title: (items) => (items.length ? fmtDateEs(items[0].raw.date, true) : ''),
            label: (item) => {
              const p = item.raw;
              return `${mx.label}: ${mx.fmt(p.rawX)} · ${my.label}: ${my.fmt(p.y)}`;
            },
          },
        },
      },
    },
  });
  registerChart('chartScatter', chart);

  // R² con etiqueta cualitativa + aviso de muestra pequeña (§6.2).
  if (info) {
    if (lr) {
      const aviso = lr.n < N_AVISO ? ' · muestra pequeña, orientativo' : '';
      info.innerHTML = `<strong>r² = ${lr.r2.toFixed(2)}</strong> · ${etiquetaR(Math.abs(lr.r))} · n=${lr.n}${aviso}`;
    } else {
      info.textContent = 'Sin ajuste posible con estos datos.';
    }
  }
}

/** Configura el explorador con un par concreto y lo repinta. */
function configurarExplorador(cx, cy) {
  if (METRICAS[cx]) estado.x = cx;
  if (METRICAS[cy]) estado.y = cy;
  sincronizarControles();
  if (inicializado) renderScatter();
}

/**
 * initExplorador(ctx) — puebla los selects, cablea listeners y pinta el
 * scatter inicial. app.js la llama UNA vez (re-llamarla es seguro: los
 * listeners se asignan por propiedad y los selects se reconstruyen).
 */
export function initExplorador(ctx) {
  const card = $('cardExplorador');
  if (!card) return;
  const runs = ctx && ctx.data ? ctx.data.runs : null;

  if (!Array.isArray(runs) || !runs.length) {
    const info = $('scatterInfo');
    if (info) info.textContent = '';
    emptyState(card, 'El explorador necesita runs.json — sin carreras cargadas no hay nada que cruzar');
    return;
  }
  runsRef = runs;
  clearEmptyState(card);

  // Selects: reconstruir opciones (idempotente en re-init).
  const selX = $('scatterX');
  const selY = $('scatterY');
  const poblar = (sel, campos) => {
    sel.textContent = '';
    for (const campo of campos) {
      const opt = document.createElement('option');
      opt.value = campo;
      opt.textContent = METRICAS[campo].label;
      sel.appendChild(opt);
    }
  };
  poblar(selX, CAMPOS_X);
  poblar(selY, CAMPOS_Y);

  // Listeners por propiedad: no se duplican si init se ejecuta dos veces.
  selX.onchange = () => configurarExplorador(selX.value, estado.y);
  selY.onchange = () => configurarExplorador(estado.x, selY.value);
  const preset = $('presetBedtime');
  if (preset) preset.onclick = () => configurarExplorador('bedtime_prev', 'ef');

  inicializado = true;
  sincronizarControles();
  renderScatter();
}

/* ==========================================================================
   Correlaciones destacadas (#cardCorrelaciones)
   ========================================================================== */

/** Frase en español del tile según su posición y si es la anti-intuición. */
function fraseTile(item, idx) {
  const mx = METRICAS[item.cx];
  const my = METRICAS[item.cy];
  if (item.anti) {
    return `La anti-intuición: ${mx.frase} apenas predice tu ${my.frase} — cuidado con las conclusiones fáciles.`;
  }
  if (idx === 0) {
    return cap(`${mx.frase} es tu mejor predictor de ${my.frase}.`);
  }
  return cap(`${mx.frase} también se asocia con ${my.frase} (relación ${item.r >= 0 ? 'positiva' : 'negativa'}).`);
}

/**
 * renderCorrelaciones(ctx) — 3 tiles precalculados sobre el histórico:
 * top |r| con n≥15 + la anti-intuición del sueño (sleep_score_prev→ef)
 * forzada como 3.ª si no sale sola en el top. Click → configura el
 * explorador y hace scroll suave hasta él.
 */
export function renderCorrelaciones(ctx) {
  const card = $('cardCorrelaciones');
  if (!card) return;
  const cont = $('corrTiles');
  const runs = ctx && ctx.data ? ctx.data.runs : null;

  if (!Array.isArray(runs) || !runs.length) {
    emptyState(card, 'Sin carreras cargadas: las correlaciones necesitan runs.json');
    return;
  }
  if (!runsRef) runsRef = runs; // por si un click llega antes de initExplorador

  // Todas las combinaciones X×Y con n≥15 (guarda de muestra mínima).
  const candidatos = [];
  for (const cx of CAMPOS_X) {
    for (const cy of CAMPOS_Y) {
      const puntos = construirPares(runs, cx, cy);
      const lr = linreg(puntos.map((p) => p.x), puntos.map((p) => p.y));
      if (lr && lr.n >= N_MIN_CORR) candidatos.push({ cx, cy, r: lr.r, n: lr.n });
    }
  }

  if (!candidatos.length) {
    emptyState(card, `Aún no hay ${N_MIN_CORR} carreras con métricas emparejadas — los destacados aparecerán con más datos`);
    return;
  }
  clearEmptyState(card);

  // Nota honesta: el n de la muestra se rellena dinámico (cero notas que mienten, §1).
  const corrN = $('corrN');
  if (corrN) corrN.textContent = `n=${runs.length} carreras — muestra pequeña`;

  // Top |r| descendente; la anti-intuición del sueño entra sí o sí (si tiene n≥15).
  candidatos.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  const seleccion = candidatos.slice(0, 3);
  const anti = candidatos.find((c) => c.cx === PAR_ANTI.cx && c.cy === PAR_ANTI.cy);
  if (anti) {
    const yaDentro = seleccion.includes(anti);
    if (yaDentro) {
      anti.anti = true;
    } else if (seleccion.length === 3) {
      seleccion[2] = { ...anti, anti: true };
    } else {
      seleccion.push({ ...anti, anti: true });
    }
  }

  // Tiles clicables (button.tile.tile-corr con .tile-r).
  cont.textContent = '';
  seleccion.forEach((item, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tile tile-corr';

    const p = document.createElement('p');
    p.textContent = fraseTile(item, idx);
    btn.appendChild(p);

    const rLine = document.createElement('div');
    rLine.className = 'tile-r';
    rLine.textContent = `r=${item.r.toFixed(2)} · ${etiquetaR(Math.abs(item.r))} · n=${item.n}`;
    btn.appendChild(rLine);

    btn.setAttribute('aria-label', `${fraseTile(item, idx)} Abrir en el explorador de correlaciones.`);
    btn.addEventListener('click', () => {
      configurarExplorador(item.cx, item.cy);
      const explorador = $('cardExplorador');
      if (explorador) explorador.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    cont.appendChild(btn);
  });
}
