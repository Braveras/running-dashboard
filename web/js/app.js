/* ==========================================================================
   app.js — orquestador: init → loadData → shell de pestañas (§4 spec salud)
   + render bajo demanda. Los módulos se implementan contra INTERFACES.md.

   Estrategia de imports (transición a «Salud integral»):
   - Módulos EXISTENTES (today, charts, heatmap, modal, scatter, insights):
     import estático de NAMESPACE (`import * as`). Un export aún no escrito
     (p.ej. Today.renderConstantes antes de que el constructor lo añada) vale
     `undefined` sin romper el grafo de módulos — la card muestra emptyState.
   - Módulos NUEVOS (entrenar-garmin.js, recuperar.js, cuerpo.js): import()
     DINÁMICO con try/catch. Si el fichero aún no existe (404), sus cards
     muestran emptyState y el resto de la web funciona con paridad total.
   Cuando los constructores desplieguen sus módulos, TODO se activa solo,
   sin tocar este fichero.
   ========================================================================== */

import {
  loadData, setData, getData, setRange, getRange, buildCtx, applyChartDefaults,
  TAB_IDS, setTabRenders, getTab, markDirtyExcept, invalidateTabs,
  resizeVisibleCharts,
} from './state.js';
import { TOKENS, setPaletteTheme, emptyState } from './helpers.js';
import * as Today from './today.js';
import * as Charts from './charts.js';
import * as Heatmap from './heatmap.js';
import * as Modal from './modal.js';
import * as Scatter from './scatter.js';
import * as Insights from './insights.js';

/* ---------- Módulos nuevos (carga dinámica tolerante a 404) ---------- */

const RUTAS_MODULOS_NUEVOS = [
  ['entrenarGarmin', './entrenar-garmin.js'],
  ['recuperar', './recuperar.js'],
  ['cuerpo', './cuerpo.js'],
];

/** Namespaces de los módulos nuevos, o null si aún no están desplegados. */
const mods = { entrenarGarmin: null, recuperar: null, cuerpo: null };

async function cargarModulosNuevos() {
  await Promise.all(RUTAS_MODULOS_NUEVOS.map(async ([clave, ruta]) => {
    try {
      mods[clave] = await import(ruta);
    } catch (_e) {
      mods[clave] = null; // aún no desplegado: sus cards degradan a emptyState
    }
  }));
}

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

/* ---------- Insights: 1 por pestaña (5) + el del header (§4) ----------
   Cadenas de fallback para la transición: mientras insights.js no exporte
   los nuevos por pestaña, se usa el insight de acto más afín. Cada fn es
   pura y devuelve su fallback neutro; aquí solo se elige la primera
   disponible que devuelva texto. */

function renderInsights(data) {
  const primera = (fns) => {
    for (const fn of fns) {
      if (typeof fn !== 'function') continue;
      try {
        const t = fn(data);
        if (typeof t === 'string' && t) return t;
      } catch (e) {
        console.error('[Zona Dos] insight falló:', e);
      }
    }
    return '';
  };
  setText('insightDia', primera([Insights.insightDelDia]));
  setText('insightHoy', primera([Insights.insightHoy]));
  setText('insightEntrenar', primera([Insights.insightEntrenar, Insights.insightSemana, Insights.insightProgreso]));
  setText('insightRecuperar', primera([Insights.insightRecuperar, Insights.insightRecuperacion]));
  setText('insightCuerpo', primera([Insights.insightCuerpo]));
  setText('insightArchivo', primera([Insights.insightArchivo]));
}

/* ---------- Registro de renders por pestaña ----------
   Cada def: pestaña, card del DOM, si depende del rango global y su render.
   `fn` puede ser undefined (módulo/función aún no desplegado): la card
   muestra un emptyState explicativo y NO entra en el registry. */

function construirDefs() {
  const EG = mods.entrenarGarmin || {};
  const RC = mods.recuperar || {};
  const CP = mods.cuerpo || {};

  // Transición PRs (§4): la card computada en cliente vive mientras el módulo
  // nuevo no cubra PRs oficiales + predicciones; cuando ambos existen, muere.
  const legacyPRs = !(typeof EG.renderPRsOficiales === 'function'
    && typeof EG.renderPredicciones === 'function');
  const elPRs = $('cardPRs');
  if (elPRs) elPRs.hidden = !legacyPRs;

  return [
    // HOY (toda la pestaña ignora el rango)
    { tab: 'hoy', card: 'cardSemaforo', rango: false, fn: Today.renderSemaforo },
    { tab: 'hoy', card: 'cardDesgloseReadiness', rango: false, fn: Today.renderDesgloseReadiness },
    { tab: 'hoy', card: 'cardConstantes', rango: false, fn: Today.renderConstantes },
    // ENTRENAR
    { tab: 'entrenar', card: 'cardTiles', rango: true, fn: Today.renderStatTiles },
    { tab: 'entrenar', card: 'cardKmSemana', rango: true, fn: Charts.renderKmSemana },
    { tab: 'entrenar', card: 'cardEF', rango: true, fn: Charts.renderEF },
    { tab: 'entrenar', card: 'cardRitmoFc', rango: true, fn: Charts.renderRitmoFc },
    { tab: 'entrenar', card: 'cardDesacople', rango: true, fn: Charts.renderDesacople },
    { tab: 'entrenar', card: 'cardZonas', rango: false, fn: Charts.renderZonas },
    { tab: 'entrenar', card: 'cardIntensidad', rango: true, fn: Charts.renderIntensidad },
    { tab: 'entrenar', card: 'cardCadencia', rango: true, fn: Charts.renderCadencia },
    { tab: 'entrenar', card: 'cardMensual', rango: false, fn: Charts.renderMensual },
    ...(legacyPRs ? [{ tab: 'entrenar', card: 'cardPRs', rango: false, fn: Charts.renderPRs }] : []),
    { tab: 'entrenar', card: 'cardPRsOficiales', rango: false, fn: EG.renderPRsOficiales },
    { tab: 'entrenar', card: 'cardPredicciones', rango: false, fn: EG.renderPredicciones },
    { tab: 'entrenar', card: 'cardUmbral', rango: false, fn: EG.renderUmbral },
    { tab: 'entrenar', card: 'cardCargaGarmin', rango: false, fn: EG.renderCargaGarmin },
    // RECUPERAR
    { tab: 'recuperar', card: 'cardSueno', rango: true, fn: Charts.renderSueno },
    { tab: 'recuperar', card: 'cardHrv', rango: true, fn: Charts.renderHrv },
    { tab: 'recuperar', card: 'cardReadinessTiempo', rango: true, fn: RC.renderReadinessTiempo },
    { tab: 'recuperar', card: 'cardEstresDiario', rango: true, fn: RC.renderEstresDiario },
    { tab: 'recuperar', card: 'cardEstresSemanal', rango: true, fn: RC.renderEstresSemanal },
    { tab: 'recuperar', card: 'cardBodyBattery', rango: true, fn: RC.renderBodyBattery },
    { tab: 'recuperar', card: 'cardMensualRecuperacion', rango: false, fn: RC.renderMensualRecuperacion },
    // CUERPO
    { tab: 'cuerpo', card: 'cardRhr', rango: true, fn: CP.renderRhr },
    { tab: 'cuerpo', card: 'cardSpo2', rango: true, fn: CP.renderSpo2 },
    { tab: 'cuerpo', card: 'cardRespiracion', rango: true, fn: CP.renderRespiracion },
    { tab: 'cuerpo', card: 'cardEdadFitness', rango: false, fn: CP.renderEdadFitness },
    { tab: 'cuerpo', card: 'cardPeso', rango: false, fn: CP.renderPeso },
    { tab: 'cuerpo', card: 'cardActividad', rango: true, fn: CP.renderActividad },
    { tab: 'cuerpo', card: 'cardMensualCuerpo', rango: false, fn: CP.renderMensualCuerpo },
    // ARCHIVO (initExplorador es re-init seguro: cuenta como render exento)
    { tab: 'archivo', card: 'cardHeatmap', rango: false, fn: Heatmap.renderHeatmap },
    { tab: 'archivo', card: 'cardCorrelaciones', rango: false, fn: Scatter.renderCorrelaciones },
    { tab: 'archivo', card: 'cardExplorador', rango: false, fn: Scatter.initExplorador },
    { tab: 'archivo', card: 'cardHistorial', rango: false, fn: Modal.renderHistorial },
  ];
}

/** Puebla el registry de state.js y degrada a emptyState las cards sin módulo. */
function registrarPestanas() {
  const defs = construirDefs();
  for (const tabId of TAB_IDS) {
    const propias = defs.filter((d) => d.tab === tabId);
    const dependientes = [];
    const exentos = [];
    for (const d of propias) {
      if (typeof d.fn === 'function') {
        (d.rango ? dependientes : exentos).push(d.fn);
      } else {
        const card = $(d.card);
        if (card) emptyState(card, 'En construcción — el módulo de esta sección aún no está desplegado.');
      }
    }
    setTabRenders(tabId, { dependientes, exentos });
  }
}

/* ---------- Pestañas: showTab + routing por hash (§4) ---------- */

let tabActiva = 'hoy';

/** Hash actual → id de pestaña; desconocido o vacío → 'hoy'. */
function tabDesdeHash() {
  const h = location.hash.replace(/^#/, '');
  return TAB_IDS.includes(h) ? h : 'hoy';
}

/**
 * Muestra la pestaña `id`: aria-selected + roving tabindex en los tabs,
 * [hidden] en los paneles, replaceState (no ensuciar el historial) y
 * render bajo demanda (primera activación completa; solo dependientes
 * si quedó dirty por un cambio de rango en otra pestaña).
 */
function showTab(id) {
  if (!TAB_IDS.includes(id)) id = 'hoy';
  tabActiva = id;
  document.querySelectorAll('#tabBar [role="tab"]').forEach((btn) => {
    const sel = btn.dataset.tab === id;
    btn.setAttribute('aria-selected', String(sel));
    btn.tabIndex = sel ? 0 : -1;
  });
  for (const t of TAB_IDS) {
    const panel = $(`panel-${t}`);
    if (panel) panel.hidden = t !== id;
  }
  if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
  activarRenders(id);
  // Un canvas que estuvo oculto puede haber colapsado: resize de los visibles.
  requestAnimationFrame(() => resizeVisibleCharts());
}

/** Render bajo demanda de la pestaña `id` según su entrada del registry. */
function activarRenders(id) {
  if (!getData()) return; // antes de que resuelva loadData(): init pintará
  const e = getTab(id);
  if (!e) return;
  const ctx = buildCtx();
  if (!e.rendered) {
    for (const fn of e.exentos) safe(fn, ctx);
    for (const fn of e.dependientes) safe(fn, ctx);
    e.rendered = true;
    e.dirty = false;
  } else if (e.dirty) {
    for (const fn of e.dependientes) safe(fn, ctx);
    e.dirty = false;
  }
}

function wireTabs() {
  const bar = $('tabBar');
  if (!bar) return;
  bar.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[role="tab"]');
    if (btn) showTab(btn.dataset.tab);
  });
  // Flechas ←/→ (+ Home/End) con activación al mover el foco (roving tabindex).
  bar.addEventListener('keydown', (ev) => {
    const teclas = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!teclas.includes(ev.key)) return;
    const tabs = [...bar.querySelectorAll('[role="tab"]')];
    const idx = tabs.findIndex((b) => b.dataset.tab === tabActiva);
    let destino = idx;
    if (ev.key === 'ArrowLeft') destino = (idx - 1 + tabs.length) % tabs.length;
    if (ev.key === 'ArrowRight') destino = (idx + 1) % tabs.length;
    if (ev.key === 'Home') destino = 0;
    if (ev.key === 'End') destino = tabs.length - 1;
    ev.preventDefault();
    tabs[destino].focus();
    showTab(tabs[destino].dataset.tab);
  });
  // Deep-link: hash editado a mano o navegación externa.
  window.addEventListener('hashchange', () => showTab(tabDesdeHash()));
}

/* ---------- Rango global ---------- */

function onRangeChanged() {
  if (!getData()) return; // click antes de que resuelva loadData(): nada que pintar aún
  const ctx = buildCtx();
  const e = getTab(tabActiva);
  if (e && e.rendered) {
    for (const fn of e.dependientes) safe(fn, ctx);
  }
  markDirtyExcept(tabActiva); // las demás se ponen al día al activarse
}

function wireRangeSelector() {
  const botones = document.querySelectorAll('#rangeSelector .range-btn');
  botones.forEach((btn) => {
    btn.addEventListener('click', () => {
      const r = btn.dataset.range === 'all' ? 'all' : Number(btn.dataset.range);
      if (r === getRange()) return;
      setRange(r);
      botones.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      onRangeChanged();
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

/**
 * Cambio de tema: invalida TODAS las pestañas (los charts vivos quedaron con
 * la paleta vieja) y re-renderiza entera solo la visible; las demás se
 * reconstruyen al activarse (render bajo demanda, mismo camino que el init).
 */
function onThemeChanged() {
  if (!getData()) return; // init pintará ya con la paleta nueva
  invalidateTabs();
  activarRenders(tabActiva);
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
  document.addEventListener('themechange', onThemeChanged);
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

  // Módulos nuevos y datos en paralelo (ninguno bloquea al otro).
  const [{ data, errores }] = await Promise.all([loadData(), cargarModulosNuevos()]);

  if (errores.length === 6) {
    showError('No se pudo cargar ningún fichero de datos.');
    return;
  }
  if (errores.length) {
    // Degradación parcial: se avisa qué cayó pero el resto renderiza.
    showError(`No se pudo cargar: ${errores.join(', ')}. El resto del panel sigue funcionando.`);
  }

  setData(data);
  renderFrescura(data.meta);
  renderInsights(data);

  registrarPestanas();               // registry limpio (rendered=false en todas)
  Modal.initModal(buildCtx());       // el modal antes: heatmap/tablas/PRs enlazan con él
  showTab(tabDesdeHash());           // deep-link #pestaña; desconocido → #hoy
}

/* ---------- Arranque ---------- */

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(currentTheme()); // sincroniza paleta JS + botón con el data-theme del head
  wireThemeToggle();
  wireRangeSelector();
  wireTabs();
  showTab(tabDesdeHash());    // UI de pestañas correcta YA, aunque los datos tarden
  $('retryBtn').addEventListener('click', () => init());
  init();
});
