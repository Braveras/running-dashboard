/* ==========================================================================
   app.js — orquestador: init → loadData → render inicial + wiring.
   Los módulos importados se implementan contra INTERFACES.md (contrato).
   ========================================================================== */

import {
  loadData, setData, getData, setRange, getRange, buildCtx, applyChartDefaults,
} from './state.js';
import { TOKENS, setPaletteTheme } from './helpers.js';
import { renderSemaforo, renderStatTiles } from './today.js';
import {
  renderKmSemana, renderPRs, renderEF, renderRitmoFc, renderDesacople,
  renderMensual, renderZonas, renderIntensidad, renderCadencia,
  renderSueno, renderHrv,
} from './charts.js';
import { renderHeatmap } from './heatmap.js';
import { initModal, renderHistorial } from './modal.js';
import { renderCorrelaciones, initExplorador } from './scatter.js';
import {
  insightDelDia, insightHoy, insightSemana, insightProgreso,
  insightIntensidad, insightRecuperacion, insightArchivo,
} from './insights.js';

/* ---------- Renders dependientes del rango (§6.1) ----------
   Al cambiar el rango SOLO se re-renderizan estas. Las exentas
   (semáforo, PRs, mes a mes, zonas, heatmap, correlaciones,
   explorador, historial) llevan badge «histórico completo». */
const DEPENDIENTES_DE_RANGO = [
  renderStatTiles,   // «Tiempo total del rango»
  renderKmSemana,
  renderEF,
  renderRitmoFc,
  renderDesacople,
  renderIntensidad,
  renderCadencia,
  renderSueno,
  renderHrv,
];

const EXENTAS_DE_RANGO = [
  renderSemaforo,
  renderPRs,
  renderMensual,
  renderZonas,
  renderHeatmap,
  renderCorrelaciones,
  renderHistorial,
];

/* ---------- Utilidades DOM ---------- */

const $ = (id) => document.getElementById(id);

function setText(id, txt) {
  const el = $(id);
  if (el && typeof txt === 'string') el.textContent = txt;
}

/** Ejecuta un render sin dejar caer la página entera (degradación parcial). */
function safe(fn, ctx) {
  try {
    fn(ctx);
  } catch (e) {
    console.error(`[Zona Dos] fallo en ${fn.name}:`, e);
  }
}

/* ---------- Banner de error ---------- */

function showError(msg) {
  setText('errorMsg', msg);
  $('errorBanner').hidden = false;
}

function hideError() {
  $('errorBanner').hidden = true;
}

/* ---------- Chip de frescura + footer (meta.json:updated) ---------- */

function renderFrescura(meta) {
  const chip = $('freshChip');
  if (!chip) return;
  if (!meta || typeof meta.updated !== 'string') {
    chip.textContent = 'datos: sin fecha';
    chip.classList.add('chip--stale');
    return;
  }
  const updated = new Date(meta.updated);
  const horas = (Date.now() - updated.getTime()) / 3600000;
  const hhmm = meta.updated.slice(11, 16);
  // Fecha local (no toISOString: en UTC cambiaría de día a otra hora que aquí).
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const hoyLocal = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const esHoy = meta.updated.slice(0, 10) === hoyLocal;
  if (horas > 24) {
    const dias = Math.floor(horas / 24);
    chip.textContent = `⚠ datos de hace ${dias} día${dias === 1 ? '' : 's'}`;
    chip.classList.add('chip--stale');
  } else {
    chip.textContent = `datos: ${esHoy ? 'hoy' : 'ayer'} ${hhmm}`;
    chip.classList.remove('chip--stale');
  }
  setText('footerUpdated', `Zona Dos · datos actualizados: ${meta.updated.replace('T', ' · ')}`);
}

/* ---------- Insights (funciones puras, con guardas internas) ---------- */

function renderInsights(data) {
  const mapa = [
    ['insightDia', insightDelDia],
    ['insightHoy', insightHoy],
    ['insightSemana', insightSemana],
    ['insightProgreso', insightProgreso],
    ['insightIntensidad', insightIntensidad],
    ['insightRecuperacion', insightRecuperacion],
    ['insightArchivo', insightArchivo],
  ];
  for (const [id, fn] of mapa) {
    try {
      setText(id, fn(data));
    } catch (e) {
      console.error(`[Zona Dos] insight ${id} falló:`, e);
    }
  }
}

/* ---------- Rango global ---------- */

function rerenderDependientes() {
  if (!getData()) return; // click en el rango antes de que resuelva loadData(): nada que pintar aún
  const ctx = buildCtx(); // fRuns/fDaily filtrados y ordenados UNA vez
  for (const fn of DEPENDIENTES_DE_RANGO) safe(fn, ctx);
}

function wireRangeSelector() {
  const botones = document.querySelectorAll('#rangeSelector .range-btn');
  botones.forEach((btn) => {
    btn.addEventListener('click', () => {
      const r = btn.dataset.range === 'all' ? 'all' : Number(btn.dataset.range);
      if (r === getRange()) return;
      setRange(r);
      botones.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      rerenderDependientes();
    });
  });
}

/* ---------- Tema claro/oscuro ---------- */

const THEME_KEY = 'zonados-theme';

/** Tema activo según el atributo del <html> (lo fija el script inline del head). */
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/**
 * Aplica un tema SIN re-renderizar: atributo data-theme, paleta JS, defaults
 * de Chart.js, chip meta theme-color y estado del botón toggle.
 * El re-render lo dispara el evento 'themechange' (ver wireThemeToggle).
 */
function applyTheme(theme) {
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  setPaletteTheme(theme);
  applyChartDefaults();                          // relee TOKENS mutados (no-op si Chart aún no cargó)
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', TOKENS.bg);
  const btn = $('themeToggle');
  if (btn) {
    const claro = theme === 'light';
    btn.textContent = claro ? '☀' : '🌙';
    btn.setAttribute('aria-pressed', String(claro));
    btn.setAttribute('aria-label', claro ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro');
  }
}

/** Re-render completo: la misma ruta que init (exentas + explorador + dependientes). */
function rerenderTodo() {
  if (!getData()) return; // cambio de tema antes de que resuelva loadData(): init pintará ya con la paleta nueva
  const ctx = buildCtx();
  for (const fn of EXENTAS_DE_RANGO) safe(fn, ctx);
  safe(initExplorador, ctx); // re-init seguro: selects reconstruidos, listeners por propiedad
  rerenderDependientes();
}

function wireThemeToggle() {
  const btn = $('themeToggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const next = currentTheme() === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(THEME_KEY, next); } catch (_e) { /* modo privado: no persiste */ }
    applyTheme(next);
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next } }));
  });
  document.addEventListener('themechange', rerenderTodo);
}

/* ---------- Scroll-spy ---------- */

function wireScrollSpy() {
  const enlaces = new Map(
    [...document.querySelectorAll('.acts-nav .nav-link')]
      .map((a) => [a.getAttribute('href').slice(1), a]),
  );
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      enlaces.forEach((a, id) => {
        if (id === entry.target.id) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    }
  }, { rootMargin: '-30% 0px -60% 0px' });
  document.querySelectorAll('section.acto').forEach((s) => observer.observe(s));
}

/* ---------- Init ---------- */

async function init() {
  hideError();

  // Guard del vendor: sin Chart.js no hay dashboard.
  if (typeof Chart === 'undefined') {
    showError('No se pudo cargar vendor/chart.umd.min.js — recarga la página.');
    return;
  }
  applyChartDefaults();

  const { data, errores } = await loadData();

  if (errores.length === 6) {
    showError('No se pudo cargar ningún fichero de datos.');
    return;
  }
  if (errores.length) {
    // Degradación parcial: se avisa qué cayó pero el resto renderiza.
    showError(`No se pudo cargar: ${errores.join(', ')}. El resto del cuaderno sigue funcionando.`);
  }

  setData(data);
  renderFrescura(data.meta);
  renderInsights(data);

  const ctx = buildCtx();
  initModal(ctx);                    // el modal antes: heatmap/tablas/PRs enlazan con él
  for (const fn of EXENTAS_DE_RANGO) safe(fn, ctx);
  safe(initExplorador, ctx);
  rerenderDependientes();
}

/* ---------- Arranque ---------- */

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(currentTheme()); // sincroniza paleta JS + botón con el data-theme del head
  wireThemeToggle();
  wireRangeSelector();
  wireScrollSpy();
  $('retryBtn').addEventListener('click', () => init());
  init();
});
