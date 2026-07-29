/* ==========================================================================
   modal.js — detalle de carrera en <dialog> accesible + tabla de historial.
   Contrato: INTERFACES.md §4.5 · Spec §5-6.3 y §6.
   Exporta: initModal(ctx), openRunModal(runId), renderHistorial(ctx).
   ========================================================================== */

import {
  RAMPA_ZONAS,
  paceFmt, fmtDur, fmtDateEs,
  emptyState, clearEmptyState,
} from './helpers.js';

/* ---------- Estado del módulo ---------- */

let _data = null;        // ctx.data guardado en initModal (histórico completo)
let _invoker = null;     // elemento que abrió el modal (retorno de foco)
let _wired = false;      // wiring del <dialog> hecho una sola vez
let _showAll = false;    // historial: ¿mostrar todas las filas?
let _mitadesCache = new Map(); // id → resultado de mitades (o null)

/* ---------- Utilidades de formato locales ---------- */

/** Número → string con `dec` decimales, o '–' si no es finito. */
function fnum(v, dec = 0) {
  return Number.isFinite(v) ? v.toFixed(dec) : '–';
}

/** Horas decimales (1.65) → '01:39'. Acepta valores tipo 23.5 → '23:30'. */
function bedtimeFmt(dec) {
  if (!Number.isFinite(dec)) return '–';
  const totalMin = Math.round(dec * 60);
  const h = ((Math.floor(totalMin / 60) % 24) + 24) % 24;
  const m = ((totalMin % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/* ---------- Cálculo de mitades y desacople (desde splits) ---------- */

/**
 * Reparte los splits en dos mitades POR DISTANCIA acumulada (el split
 * frontera se divide proporcionalmente) y calcula por mitad: ritmo (s/km),
 * FC media ponderada por tiempo y EF = velocidad (m/min) / FC.
 * Desacople % = (EF1 − EF2) / EF1 × 100 (positivo = 2.ª mitad menos eficiente).
 * @returns {{pace1,pace2,ef1,ef2,drift}|null} null si no es computable.
 */
function mitadesDeSplits(splits) {
  if (!Array.isArray(splits) || splits.length < 2) return null;
  const validos = splits.filter((s) => Number.isFinite(s.km) && s.km > 0 && Number.isFinite(s.dur_s) && s.dur_s > 0);
  if (validos.length < 2) return null;
  const totalKm = validos.reduce((a, s) => a + s.km, 0);
  if (totalKm <= 0) return null;
  const half = totalKm / 2;

  const acumular = () => ({ km: 0, dur: 0, hrSum: 0, hrDur: 0 });
  const a = acumular();
  const b = acumular();
  let acc = 0;
  for (const s of validos) {
    const ini = acc;
    acc += s.km;
    // Fracción del split que cae en la 1.ª mitad
    let fA = 0;
    if (acc <= half) fA = 1;
    else if (ini >= half) fA = 0;
    else fA = (half - ini) / s.km;
    for (const [mitad, f] of [[a, fA], [b, 1 - fA]]) {
      if (f <= 0) continue;
      mitad.km += s.km * f;
      mitad.dur += s.dur_s * f;
      if (Number.isFinite(s.hr) && s.hr > 0) {
        mitad.hrSum += s.hr * s.dur_s * f;
        mitad.hrDur += s.dur_s * f;
      }
    }
  }
  if (a.km <= 0 || b.km <= 0 || a.dur <= 0 || b.dur <= 0) return null;

  const pace1 = a.dur / a.km;
  const pace2 = b.dur / b.km;
  const hr1 = a.hrDur > 0 ? a.hrSum / a.hrDur : null;
  const hr2 = b.hrDur > 0 ? b.hrSum / b.hrDur : null;
  let ef1 = null, ef2 = null, drift = null;
  if (hr1 && hr2) {
    ef1 = ((a.km * 1000) / (a.dur / 60)) / hr1; // m/min por ppm
    ef2 = ((b.km * 1000) / (b.dur / 60)) / hr2;
    if (ef1 > 0) drift = ((ef1 - ef2) / ef1) * 100;
  }
  return { pace1, pace2, ef1, ef2, drift };
}

/** Mitades de una carrera por id, con caché (null si no hay detalle/splits). */
function mitadesDeRun(runId) {
  const key = String(runId);
  if (_mitadesCache.has(key)) return _mitadesCache.get(key);
  const detail = _data && _data.runsDetail ? _data.runsDetail[key] : null;
  const res = detail ? mitadesDeSplits(detail.splits) : null;
  _mitadesCache.set(key, res);
  return res;
}

/* ---------- PRs a nivel de fila (para los badges 🏆 del historial) ---------- */

/**
 * Ids de carreras que ostentan un PR de fila: mejor ritmo, más larga,
 * mejor EF y mejor km de splits (splits ≥0.8 km para evitar colas cortas).
 * @returns {Set<string>}
 */
function idsConPr(runs) {
  const ids = new Set();
  const mejor = (campo, cmp) => {
    let best = null;
    for (const r of runs) {
      const v = r[campo];
      if (!Number.isFinite(v)) continue;
      if (best === null || cmp(v, best.v)) best = { v, id: r.id };
    }
    if (best) ids.add(String(best.id));
  };
  mejor('pace_s', (v, b) => v < b); // mejor ritmo = menor
  mejor('km', (v, b) => v > b);     // más larga
  mejor('ef', (v, b) => v > b);     // mejor EF

  // Mejor km de splits (runs_detail): menor dur_s/km entre splits ≥0.8 km
  if (_data && _data.runsDetail) {
    let best = null;
    for (const r of runs) {
      const d = _data.runsDetail[String(r.id)];
      if (!d || !Array.isArray(d.splits)) continue;
      for (const s of d.splits) {
        if (!Number.isFinite(s.km) || s.km < 0.8 || !Number.isFinite(s.dur_s)) continue;
        const p = s.dur_s / s.km;
        if (best === null || p < best.p) best = { p, id: r.id };
      }
    }
    if (best) ids.add(String(best.id));
  }
  return ids;
}

/* ---------- Wiring del <dialog> (accesibilidad §5-6.3) ---------- */

/**
 * initModal(ctx) — app.js la llama UNA vez ANTES que el resto de renders.
 * Guarda los datos y cablea: cierre (botón, Escape nativo + cancel),
 * scroll-lock del body, foco al botón cerrar al abrir, focus trap,
 * y retorno de foco al invocador al cerrar.
 */
export function initModal(ctx) {
  _data = ctx && ctx.data ? ctx.data : null;
  _mitadesCache = new Map(); // los datos pueden haber cambiado (reintento)

  if (_wired) return;
  const dialog = document.getElementById('runModal');
  const closeBtn = document.getElementById('modalClose');
  if (!dialog || !closeBtn) return;

  // Cierre con fallback simétrico al de apertura: sin HTMLDialogElement no hay
  // close(), así que quitamos [open] y emitimos 'close' a mano para que el
  // listener de abajo restaure scroll y foco por el mismo camino.
  closeBtn.addEventListener('click', () => {
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
      dialog.dispatchEvent(new Event('close'));
    }
  });

  // Escape: <dialog> lo gestiona nativo vía el evento `cancel` (no lo bloqueamos).
  // Al cerrar (por Escape, botón o close()): desbloquear scroll y devolver el foco.
  dialog.addEventListener('close', () => {
    document.body.style.overflow = '';
    if (_invoker && typeof _invoker.focus === 'function' && document.contains(_invoker)) {
      _invoker.focus();
    }
    _invoker = null;
  });

  // Focus trap explícito: showModal() ya confina el foco, pero reforzamos
  // el ciclo Tab/Shift+Tab dentro del diálogo (cinturón y tirantes).
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusables = [...dialog.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )].filter((el) => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  _wired = true;
}

/* ---------- Contenido del modal ---------- */

/** Barra apilada horizontal de zonas (rampa azul) + leyenda textual. */
function htmlZonas(zones) {
  if (!Array.isArray(zones) || !zones.length) return '';
  const total = zones.reduce((a, z) => a + (Number.isFinite(z.secs) ? z.secs : 0), 0);
  if (total <= 0) return '';
  const pcts = zones.map((z) => ({
    zone: z.zone,
    pct: ((Number.isFinite(z.secs) ? z.secs : 0) / total) * 100,
  }));
  const spans = pcts
    .filter((z) => z.pct > 0)
    .map((z) => {
      const color = RAMPA_ZONAS[(z.zone || 1) - 1] || RAMPA_ZONAS[0];
      return `<span style="width:${z.pct.toFixed(1)}%;background:${color}" title="Z${z.zone}: ${z.pct.toFixed(0)} %"></span>`;
    })
    .join('');
  const leyenda = pcts.map((z) => `Z${z.zone} ${z.pct.toFixed(0)} %`).join(' · ');
  const aria = `Tiempo en zonas Garmin: ${leyenda}`;
  return `
    <h4>Zonas de FC</h4>
    <div class="modal-zonas" role="img" aria-label="${aria}">${spans}</div>
    <p class="note">${leyenda} · zonas Garmin</p>`;
}

/** Tabla de splits estilada como el resto de tablas (.splits-table, td.num). */
function htmlSplits(splits) {
  if (!Array.isArray(splits) || !splits.length) return '';
  const filas = splits.map((s, i) => {
    const pace = (Number.isFinite(s.dur_s) && Number.isFinite(s.km) && s.km > 0)
      ? paceFmt(s.dur_s / s.km) : '–';
    return `<tr>
      <td class="num">${i + 1}</td>
      <td class="num">${fnum(s.km, 2)}</td>
      <td class="num">${Number.isFinite(s.dur_s) ? fmtDur(s.dur_s) : '–'}</td>
      <td class="num">${pace}</td>
      <td class="num">${fnum(s.hr, 0)}</td>
      <td class="num">${fnum(s.hr_max, 0)}</td>
      <td class="num">${fnum(s.cadence, 0)}</td>
    </tr>`;
  }).join('');
  return `
    <h4>Splits</h4>
    <div class="splits-table">
      <table>
        <thead>
          <tr><th class="num">#</th><th class="num">Km</th><th class="num">Tiempo</th><th class="num">Ritmo</th><th class="num">FC</th><th class="num">FC máx</th><th class="num">Cad</th></tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
}

/** Fila de desacople + comparación 1.ª/2.ª mitad con texto+icono. */
function htmlDesacople(run, mitades) {
  if (!mitades) {
    return '<p class="note">Sin splits: desacople no calculable para esta carrera.</p>';
  }
  const { pace1, pace2, drift } = mitades;
  const comparacion = `1.ª mitad <strong>${paceFmt(pace1)}</strong> /km · 2.ª mitad <strong>${paceFmt(pace2)}</strong> /km`;
  // Icono+texto: el color de estado va en el juicio, nunca en datos (§2.3).
  const juicio = pace2 < pace1
    ? '<span class="tile-delta delta-mejor">▲ 2.ª mitad más rápida (split negativo)</span>'
    : '<span class="tile-delta delta-peor">▼ 2.ª mitad más lenta</span>';
  const corta = Number.isFinite(run.km) && run.km < 3
    ? ' · carrera corta (&lt;3 km): orientativo' : '';
  const driftTxt = Number.isFinite(drift)
    ? `Desacople de esta carrera: <strong>${drift.toFixed(1)} %</strong> · umbral sano ≤5 %${corta}`
    : 'Desacople no calculable (faltan datos de FC en los splits)';
  return `
    <h4>Desacople aeróbico</h4>
    <p class="kpi-line">${driftTxt}</p>
    <p class="kpi-line">${comparacion} ${juicio}</p>`;
}

/**
 * openRunModal(runId) — abre el detalle de una carrera.
 * GUARD obligatorio: si la carrera no existe → return silencioso.
 */
export function openRunModal(runId) {
  const dialog = document.getElementById('runModal');
  const title = document.getElementById('modalTitle');
  const body = document.getElementById('modalBody');
  if (!dialog || !title || !body) return;
  if (!_data || !Array.isArray(_data.runs)) return;

  const idNum = Number(runId);
  const run = _data.runs.find((r) => Number(r.id) === idNum);
  if (!run) return; // guard del spec: celda/fila sin carrera → nada

  const detail = _data.runsDetail ? _data.runsDetail[String(run.id)] : null;
  const mitades = mitadesDeRun(run.id);

  title.textContent = `${fmtDateEs(run.date, true)} · ${fnum(run.km, 2)} km`;

  /* --- Métricas principales --- */
  const partes = [];
  partes.push(`Duración <strong>${Number.isFinite(run.dur_s) ? fmtDur(run.dur_s) : '–'}</strong>`);
  partes.push(`Ritmo <strong>${paceFmt(run.pace_s)}</strong> /km`);
  partes.push(`FC <strong>${fnum(run.hr, 0)}</strong> (máx <strong>${fnum(run.hr_max, 0)}</strong>)`);
  partes.push(`Cadencia <strong>${fnum(run.cadence, 0)}</strong> spm`);
  partes.push(`EF <strong>${fnum(run.ef, 2)}</strong>`);
  const metricas = `<p class="kpi-line">${partes.join(' · ')}</p>`;

  /* --- Clima (weather del detalle; fallback temp_c de la carrera) --- */
  const temp = detail && detail.weather && Number.isFinite(detail.weather.temp_c)
    ? detail.weather.temp_c : run.temp_c;
  const hum = detail && detail.weather && Number.isFinite(detail.weather.humidity)
    ? detail.weather.humidity : null;
  let clima = '';
  if (Number.isFinite(temp)) {
    const calor = temp > 24 ? ' · ☀ calor: infla la FC, no es retroceso' : '';
    const humTxt = hum !== null ? ` · humedad <strong>${fnum(hum, 0)}</strong> %` : '';
    clima = `<p class="kpi-line">Clima: <strong>${fnum(temp, 1)}</strong> °C${humTxt}${calor}</p>`;
  }

  /* --- Noche previa: sueño + HRV matinal --- */
  const noche = [];
  if (Number.isFinite(run.sleep_hours_prev)) noche.push(`sueño <strong>${fnum(run.sleep_hours_prev, 1)}</strong> h`);
  if (Number.isFinite(run.sleep_score_prev)) noche.push(`score <strong>${fnum(run.sleep_score_prev, 0)}</strong>`);
  if (Number.isFinite(run.bedtime_prev)) noche.push(`acostado a las <strong>${bedtimeFmt(run.bedtime_prev)}</strong>`);
  if (Number.isFinite(run.hrv_morning)) noche.push(`HRV matinal <strong>${fnum(run.hrv_morning, 0)}</strong> ms`);
  const nocheHtml = noche.length
    ? `<p class="kpi-line">Noche previa: ${noche.join(' · ')}</p>`
    : '<p class="note">Sin datos de la noche previa.</p>';

  /* --- Detalle: zonas + splits + desacople (o nota si no hay detalle) --- */
  const detalleHtml = detail
    ? htmlZonas(detail.zones) + htmlSplits(detail.splits) + htmlDesacople(run, mitades)
    : '<p class="note">Sin detalle disponible para esta carrera (splits y zonas no exportados).</p>';

  body.innerHTML = metricas + clima + nocheHtml + detalleHtml;

  /* --- Apertura accesible: foco al cierre, retorno al cerrar ---
     Guard de soporte: en webviews sin HTMLDialogElement, showModal no existe
     → fallback con [open]. El scroll-lock va DESPUÉS de abrir con éxito para
     no dejar el body bloqueado si la apertura lanzara. */
  _invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (!dialog.open) {
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', ''); // fallback <div>-like (cerrado por el mismo camino)
    }
  }
  document.body.style.overflow = 'hidden';
  const closeBtn = document.getElementById('modalClose');
  if (closeBtn) closeBtn.focus();
}

/* ---------- Historial de carreras (§5-6.3) ---------- */

/**
 * renderHistorial(ctx) — tabla #runsTableBody con las últimas 10 de N
 * (botón «Ver todas (N)» / «Ver menos», aria-expanded). Histórico completo,
 * orden DESC. Filas con tabindex=0 y Enter/Espacio/click → openRunModal(id).
 */
export function renderHistorial(ctx) {
  const card = document.getElementById('cardHistorial');
  const tbody = document.getElementById('runsTableBody');
  const btn = document.getElementById('verTodasBtn');
  if (!card || !tbody || !btn) return;

  // Por si renderHistorial corre antes que initModal (defensivo).
  if (!_data && ctx && ctx.data) _data = ctx.data;

  const runs = ctx && ctx.data && Array.isArray(ctx.data.runs) ? ctx.data.runs : null;
  if (!runs || !runs.length) {
    emptyState(card, 'Sin carreras registradas todavía — el historial aparecerá aquí.');
    btn.hidden = true;
    return;
  }
  clearEmptyState(card);

  const desc = runs.slice().reverse(); // loadData ordena asc; mostramos DESC
  const prIds = idsConPr(runs);
  const visibles = _showAll ? desc : desc.slice(0, 10);

  tbody.innerHTML = visibles.map((r) => {
    const mit = mitadesDeRun(r.id);
    const esSplitNeg = !!(mit && mit.pace2 < mit.pace1);
    const badges = [
      prIds.has(String(r.id))
        ? '<span class="badge-pr" title="Récord personal">🏆<span class="sr-only"> récord personal</span></span>'
        : '',
      esSplitNeg ? '<span class="badge-split" title="Segunda mitad más rápida">split −</span>' : '',
    ].join(' ');
    return `<tr tabindex="0" data-id="${r.id}" aria-label="Detalle de la carrera del ${fmtDateEs(r.date, true)}">
      <td>${fmtDateEs(r.date, true)}</td>
      <td class="num">${fnum(r.km, 2)}</td>
      <td class="num">${Number.isFinite(r.dur_s) ? fmtDur(r.dur_s) : '–'}</td>
      <td class="num">${paceFmt(r.pace_s)}</td>
      <td class="num">${fnum(r.hr, 0)}</td>
      <td class="num col-fcmax">${fnum(r.hr_max, 0)}</td>
      <td class="num col-ef">${fnum(r.ef, 2)}</td>
      <td class="num col-temp">${Number.isFinite(r.temp_c) ? `${fnum(r.temp_c, 0)} °C` : '–'}</td>
      <td class="col-badges">${badges}</td>
    </tr>`;
  }).join('');

  /* Botón «Ver todas» — solo tiene sentido con más de 10 carreras */
  if (runs.length > 10) {
    btn.hidden = false;
    btn.textContent = _showAll ? 'Ver menos' : `Ver todas (${runs.length})`;
    btn.setAttribute('aria-expanded', String(_showAll));
    btn.onclick = () => { // asignación (no addEventListener): re-render idempotente
      _showAll = !_showAll;
      renderHistorial(ctx);
    };
  } else {
    btn.hidden = true;
  }

  /* Delegación de eventos (idempotente): click y Enter/Espacio abren el modal */
  tbody.onclick = (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) openRunModal(tr.dataset.id);
  };
  tbody.onkeydown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    e.preventDefault(); // que Espacio no haga scroll
    openRunModal(tr.dataset.id);
  };
}
