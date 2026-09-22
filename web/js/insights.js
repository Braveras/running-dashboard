/* ==========================================================================
   insights.js — módulo PURO: datos → frases en español (§6.6 del spec).

   Contrato (INTERFACES.md §4.7):
   - Cada función recibe `data` = ctx.data COMPLETO (histórico) y devuelve UNA
     frase en español (string). El que pinta es app.js.
   - GUARDAS obligatorias por plantilla: n mínimo, magnitud mínima del efecto,
     comparación válida y campos null. Si ninguna plantilla pasa → fallback
     neutro. «Una frase incorrecta destruye más confianza que diez gráficas.»
   - JAMÁS lanzan (todo envuelto en try/catch → fallback) y JAMÁS inventan
     datos no derivables (p.ej. nivel absoluto de Body Battery).
   - Sin DOM, sin Chart: solo importa funciones/constantes puras de helpers.js.
   ========================================================================== */

import {
  paceFmt, fmtDur, MONTH_ES, isoWeekKey, isoAddDays, isoToday, percentileRank,
} from './helpers.js';

/* ---------- Constantes del dominio ---------- */

const Z2_TECHO = 142;            // techo de FC para Z2 (ppm)
const CADENCIA_OBJ = [160, 165]; // banda objetivo de cadencia (spm)
const CADENCIA_MIN = 120;        // por debajo se considera outlier (caminando)

// Nombres largos de mes SOLO para prosa (las etiquetas de gráficas usan MONTH_ES).
const MES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/* ---------- Utilidades puras internas ---------- */

const fin = Number.isFinite;

/** Media de los valores finitos; null si no hay ninguno. */
function media(valores) {
  const v = valores.filter(fin);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Número con coma decimal española. num(6.06) → '6,1'. */
function num(x, dec = 1) {
  return fin(x) ? x.toFixed(dec).replace('.', ',') : '–';
}

/** 'YYYY-MM-DD' → índice de mes 0–11, o null si no parsea. */
function idxMes(iso) {
  const m = parseInt(String(iso).slice(5, 7), 10) - 1;
  return m >= 0 && m <= 11 ? m : null;
}

/** Nombre largo del mes de una fecha ISO ('2026-07-14' → 'julio'). */
function mesLargo(iso) {
  const m = idxMes(iso);
  return m === null ? null : MES_LARGO[m];
}

/** Nombre corto del mes (para cifras compactas): '2026-07-14' → 'jul'. */
function mesCorto(iso) {
  const m = idxMes(iso);
  return m === null ? null : MONTH_ES[m];
}

/** ¿Es un array con al menos n elementos? */
function esArray(a, n = 1) {
  return Array.isArray(a) && a.length >= n;
}

/** Carreras válidas ordenadas asc por fecha (defensa extra; state.js ya ordena). */
function carreras(data) {
  if (!esArray(data?.runs)) return [];
  return data.runs
    .filter((r) => r && typeof r.date === 'string' && r.date.length >= 10)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Días válidos ordenados asc por fecha. */
function dias(data) {
  if (!esArray(data?.daily)) return [];
  return data.daily
    .filter((d) => d && typeof d.date === 'string' && d.date.length >= 10)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Días de health.json válidos ordenados asc por fecha (fichero OPCIONAL §3.9). */
function saludDias(data) {
  if (!esArray(data?.health)) return [];
  return data.health
    .filter((d) => d && typeof d.date === 'string' && d.date.length >= 10)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Snapshots de trends.json válidos ordenados asc por fecha (fichero OPCIONAL). */
function tendencias(data) {
  if (!esArray(data?.trends)) return [];
  return data.trends
    .filter((t) => t && typeof t.date === 'string' && t.date.length >= 10)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Fecha de referencia «hoy» del cuaderno: la de meta.updated (los datos se
 * congelan ahí); fallback: último daily, última carrera, hoy local.
 */
function refHoy(data) {
  const u = data?.meta?.updated;
  if (typeof u === 'string' && u.length >= 10) return u.slice(0, 10);
  const d = dias(data);
  if (d.length) return d[d.length - 1].date;
  const r = carreras(data);
  if (r.length) return r[r.length - 1].date;
  return isoToday();
}

/** Días de diferencia entre dos ISO (b − a), en UTC. */
function diffDias(a, b) {
  const t = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86400000);
}

/** Agrupa carreras por mes 'YYYY-MM' → array de carreras. Orden de claves asc. */
function porMes(runs) {
  const map = new Map();
  for (const r of runs) {
    const k = r.date.slice(0, 7);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

/**
 * Carreras con % REAL de tiempo con FC ≤142 (fase 3): cruza runs con
 * runsDetail[id].pct_z2. Devuelve copias {…run, pct_z2} SOLO donde el campo
 * es numérico (clave ausente / null → fuera, sin lanzar). Orden asc por fecha.
 */
function carrerasZ2pct(data) {
  const det = data?.runsDetail;
  if (!det || typeof det !== 'object') return [];
  return carreras(data)
    .map((r) => ({ ...r, pct_z2: det[String(r.id)]?.pct_z2 }))
    .filter((r) => fin(r.pct_z2));
}

/**
 * Envuelve una lista de plantillas: devuelve la primera frase no nula;
 * si todas fallan (o lanzan), el fallback neutro. GARANTIZA no lanzar.
 */
function primera(plantillas, data, fallback) {
  for (const p of plantillas) {
    try {
      const frase = p(data);
      if (typeof frase === 'string' && frase.length) return frase;
    } catch { /* una plantilla rota nunca tumba el insight */ }
  }
  return fallback;
}

/* ==========================================================================
   PLANTILLAS (cada una con sus guardas; devuelven string o null)
   ========================================================================== */

/**
 * «En julio corres al ritmo de marzo con 10 ppm menos de FC media.»
 * Compara el primer mes con ≥3 carreras contra el último mes con ≥3.
 * Guardas: meses distintos y separados ≥2 meses naturales, medias finitas,
 * FC baja ≥4 ppm y ritmo igual o mejor (≤ +3 %).
 */
function tplRitmoIgualFc(data) {
  const runs = carreras(data).filter((r) => fin(r.pace_s) && fin(r.hr));
  if (runs.length < 8) return null;
  const meses = [...porMes(runs).entries()].filter(([, rs]) => rs.length >= 3);
  if (meses.length < 2) return null;
  const [k0, rs0] = meses[0];
  const [k1, rs1] = meses[meses.length - 1];
  // Comparación válida: al menos 2 meses de distancia entre ambos.
  const sep = (+k1.slice(0, 4) - +k0.slice(0, 4)) * 12 + (+k1.slice(5, 7) - +k0.slice(5, 7));
  if (sep < 2) return null;
  const pace0 = media(rs0.map((r) => r.pace_s));
  const pace1 = media(rs1.map((r) => r.pace_s));
  const hr0 = media(rs0.map((r) => r.hr));
  const hr1 = media(rs1.map((r) => r.hr));
  if (![pace0, pace1, hr0, hr1].every(fin)) return null;
  const bajadaFc = hr0 - hr1;
  if (bajadaFc < 4) return null;                 // magnitud mínima del efecto
  if (pace1 > pace0 * 1.03) return null;         // el ritmo no puede haber empeorado
  const m0 = mesLargo(`${k0}-01`);
  const m1 = mesLargo(`${k1}-01`);
  if (!m0 || !m1) return null;
  const ritmo = pace1 <= pace0 * 0.97
    ? `corres más rápido que en ${m0} (${paceFmt(pace1)} vs ${paceFmt(pace0)})`
    : `corres al ritmo de ${m0}`;
  return `En ${m1} ${ritmo} con ${Math.round(bajadaFc)} ppm menos de FC media.`;
}

/**
 * «Tu eficiencia en Z2 ha subido un 8 % desde abril.»
 * Compara el primer mes con ≥3 carreras Z2 (FC≤142) contra las últimas 4 Z2.
 * Guardas: n≥3 por lado, mejora ≥3 %, la comparación no solapa carreras.
 */
function tplEfZ2(data) {
  const z2 = carreras(data).filter((r) => fin(r.hr) && r.hr <= Z2_TECHO && fin(r.ef) && r.ef > 0);
  if (z2.length < 7) return null;
  const meses = [...porMes(z2).entries()].filter(([, rs]) => rs.length >= 3);
  if (!meses.length) return null;
  const [kBase, rsBase] = meses[0];
  const ultimas = z2.slice(-4);
  if (ultimas[0].date.slice(0, 7) === kBase) return null; // solaparía la base
  const efBase = media(rsBase.map((r) => r.ef));
  const efAhora = media(ultimas.map((r) => r.ef));
  if (!fin(efBase) || !fin(efAhora) || efBase <= 0) return null;
  const pct = ((efAhora - efBase) / efBase) * 100;
  if (pct < 3) return null;                      // magnitud mínima del efecto
  const mes = mesLargo(`${kBase}-01`);
  if (!mes) return null;
  return `Tu eficiencia aeróbica en Z2 ha subido un ${Math.round(pct)} % desde ${mes} — más metros por latido.`;
}

/**
 * «Cadencia media 140 spm: a −20 spm del objetivo 160–165.»
 * Guardas: ≥10 carreras con cadencia válida (≥120 spm), gap ≥5 spm.
 * Detecta estancamiento comparando primeras 5 vs últimas 5.
 */
function tplGapCadencia(data) {
  const conCad = carreras(data).filter((r) => fin(r.cadence) && r.cadence >= CADENCIA_MIN);
  if (conCad.length < 10) return null;
  const ult = media(conCad.slice(-10).map((r) => r.cadence));
  if (!fin(ult)) return null;
  const gap = CADENCIA_OBJ[0] - ult;
  if (gap < 5) return null;                      // magnitud mínima
  const ini = media(conCad.slice(0, 5).map((r) => r.cadence));
  const fin5 = media(conCad.slice(-5).map((r) => r.cadence));
  let estanc = '';
  if (fin(ini) && fin(fin5) && Math.abs(fin5 - ini) < 2) {
    const mes = mesLargo(conCad[0].date);
    if (mes) estanc = ` y estancada desde ${mes} (${num(ini)} → ${num(fin5)})`;
  }
  return `Cadencia media ${Math.round(ult)} spm: a −${Math.round(gap)} spm del objetivo ${CADENCIA_OBJ[0]}–${CADENCIA_OBJ[1]}${estanc}.`;
}

/**
 * «20 de 34 carreras dentro de Z2 (59 %).»
 * Guardas: ≥10 carreras con FC media válida.
 */
function tplDisciplinaZ2(data) {
  const conHr = carreras(data).filter((r) => fin(r.hr));
  if (conHr.length < 10) return null;
  const dentro = conHr.filter((r) => r.hr <= Z2_TECHO).length;
  const pct = Math.round((dentro / conHr.length) * 100);
  const calurosas = conHr.filter((r) => r.hr > Z2_TECHO && fin(r.temp_c) && r.temp_c > 24).length;
  const coda = calurosas >= 3
    ? ' — el calor de Madrid infla la FC, no es falta de control'
    : '';
  return `${dentro} de ${conHr.length} carreras con la FC media dentro de Z2 (${pct} %)${coda}.`;
}

/* ---------- Plantillas de DISCIPLINA Z2 (fase 3: runsDetail[id].pct_z2) ---------- */
/* pct_z2 = % de tiempo REAL con FC ≤142 (no la FC media): mide cuánto de cada
   carrera se corrió de verdad bajo el techo. Las tres plantillas siguientes
   son ALTERNATIVAS por prioridad (solo una se pinta por acto), no duplicados. */

/**
 * «Disciplina al alza: 62 % del tiempo por debajo de 142 ppm en tus últimas
 * 5 carreras, 14 puntos más que en las 5 anteriores.»
 * Guardas: ≥10 carreras con pct_z2 (dos ventanas de 5 SIN solape) y cambio
 * ≥10 puntos — por debajo es ruido entre salidas, no tendencia (§6.6).
 * Habla de «tus últimas 5 carreras» (relativo al histórico registrado), así
 * que sigue siendo cierta aunque los datos se congelen.
 */
function tplZ2Tendencia5(data) {
  const rs = carrerasZ2pct(data);
  if (rs.length < 10) return null;               // n mínimo: 5 + 5 sin solape
  const ult = media(rs.slice(-5).map((r) => r.pct_z2));
  const prev = media(rs.slice(-10, -5).map((r) => r.pct_z2));
  if (!fin(ult) || !fin(prev)) return null;
  const delta = ult - prev;
  if (Math.abs(delta) < 10) return null;         // magnitud mínima: 10 puntos
  if (delta > 0) {
    return `Disciplina al alza: ${Math.round(ult)} % del tiempo por debajo de 142 ppm en tus últimas 5 carreras, ${Math.round(delta)} puntos más que en las 5 anteriores.`;
  }
  return `Tus últimas 5 carreras bajan al ${Math.round(ult)} % del tiempo por debajo de 142 ppm, ${Math.round(-delta)} puntos menos que las 5 anteriores — vuelve a frenar desde el primer kilómetro.`;
}

/**
 * «En julio has pasado el 59 % del tiempo por debajo de 142 ppm, 12 puntos
 * más que en junio.»
 * Compara los DOS últimos meses con base suficiente, y solo si son meses
 * naturales consecutivos (mayo vs marzo confundiría al lector).
 * Guardas: ≥4 carreras con pct_z2 por mes, meses consecutivos, cambio ≥10
 * puntos. Nombra los meses explícitamente → cierta también con datos viejos.
 */
function tplZ2Meses(data) {
  const rs = carrerasZ2pct(data);
  if (rs.length < 8) return null;                // n mínimo global (4 + 4)
  const meses = [...porMes(rs).entries()].filter(([, v]) => v.length >= 4);
  if (meses.length < 2) return null;
  const [k0, rs0] = meses[meses.length - 2];
  const [k1, rs1] = meses[meses.length - 1];
  const sep = (+k1.slice(0, 4) - +k0.slice(0, 4)) * 12 + (+k1.slice(5, 7) - +k0.slice(5, 7));
  if (sep !== 1) return null;                    // solo meses consecutivos
  const m0 = media(rs0.map((r) => r.pct_z2));
  const m1 = media(rs1.map((r) => r.pct_z2));
  if (!fin(m0) || !fin(m1)) return null;
  const delta = m1 - m0;
  if (Math.abs(delta) < 10) return null;         // magnitud mínima: 10 puntos
  const n0 = mesLargo(`${k0}-01`);
  const n1 = mesLargo(`${k1}-01`);
  if (!n0 || !n1) return null;
  if (delta > 0) {
    return `En ${n1} has pasado el ${Math.round(m1)} % del tiempo por debajo de 142 ppm, ${Math.round(delta)} puntos más que en ${n0} — la disciplina va a mejor.`;
  }
  return `En ${n1} el tiempo por debajo de 142 ppm cae al ${Math.round(m1)} % (${n0}: ${Math.round(m0)} %) — el freno se está soltando.`;
}

/**
 * «Tu carrera más disciplinada de julio: 68 % del tiempo por debajo de
 * 142 ppm el día 14 (3,1 km).»
 * Guardas: ≥5 carreras con pct_z2 en total, ≥3 en el mes de referencia,
 * salidas ≥2 km (un trote de 1 km no representa disciplina) y la mejor ≥60 %
 * — elogiar un «mejor» del 40 % sonaría a burla. Nombra el mes explícitamente
 * (el de refHoy, es decir, el de los propios datos) → no miente si envejecen.
 */
function tplZ2MejorMes(data) {
  const rs = carrerasZ2pct(data).filter((r) => fin(r.km) && r.km >= 2);
  if (rs.length < 5) return null;                // n mínimo global
  const mesRef = refHoy(data).slice(0, 7);
  const delMes = rs.filter((r) => r.date.slice(0, 7) === mesRef);
  if (delMes.length < 3) return null;            // n mínimo del mes
  const mejor = delMes.reduce((a, r) => (r.pct_z2 > a.pct_z2 ? r : a));
  if (mejor.pct_z2 < 60) return null;            // magnitud mínima del elogio
  const mes = mesLargo(mejor.date);
  if (!mes) return null;
  return `Tu carrera más disciplinada de ${mes}: ${Math.round(mejor.pct_z2)} % del tiempo por debajo de 142 ppm el día ${+mejor.date.slice(8, 10)} (${num(mejor.km)} km).`;
}

/**
 * «4 carreras seguidas con más del 70 % del tiempo por debajo de 142 ppm.»
 * Racha VIVA (contada desde la última carrera hacia atrás), con el récord
 * histórico como coda. Misma convención que tplRacha: habla de carreras
 * registradas, no del calendario, así que no necesita guarda de frescura.
 * Guardas: ≥5 carreras con pct_z2 y racha ≥3 (2 seguidas no es racha).
 */
function tplZ2RachaViva(data) {
  const rs = carrerasZ2pct(data);
  if (rs.length < 5) return null;                // n mínimo
  let racha = 0;
  for (let i = rs.length - 1; i >= 0 && rs[i].pct_z2 > 70; i--) racha++;
  if (racha < 3) return null;                    // magnitud mínima
  let mejor = 0;
  let cur = 0;
  for (const r of rs) {
    cur = r.pct_z2 > 70 ? cur + 1 : 0;
    if (cur > mejor) mejor = cur;
  }
  const coda = racha >= mejor ? ' — tu mejor racha del histórico' : ` (récord: ${mejor})`;
  return `${racha} carreras seguidas con más del 70 % del tiempo por debajo de 142 ppm${coda}.`;
}

/**
 * «Llevas 5,2 km esta semana, un 30 % por encima de tu media de 4 semanas.»
 * Guardas: histórico ≥28 días, media previa > 0, desviación ≥20 %.
 */
function tplKmSemana(data) {
  const runs = carreras(data).filter((r) => fin(r.km));
  if (runs.length < 4) return null;
  const hoy = refHoy(data);
  // Guarda de frescura: «llevas X km esta semana» habla en presente; con datos
  // congelados >1 día la frase mentiría (§6.6) → cede el turno a otra plantilla.
  if (diffDias(hoy, isoToday()) > 1) return null;
  if (diffDias(runs[0].date, hoy) < 28) return null; // comparación aún no válida
  const porSemana = new Map();
  for (const r of runs) {
    const k = isoWeekKey(r.date);
    porSemana.set(k, (porSemana.get(k) || 0) + r.km);
  }
  const semActual = isoWeekKey(hoy);
  const kmAhora = porSemana.get(semActual) || 0;
  // Las 4 semanas ANTERIORES (las sin carreras cuentan 0: es volumen real).
  const previas = [1, 2, 3, 4].map((i) => porSemana.get(isoWeekKey(isoAddDays(hoy, -7 * i))) || 0);
  const media4 = media(previas);
  if (!fin(media4) || media4 <= 0) return null;
  const delta = ((kmAhora - media4) / media4) * 100;
  if (Math.abs(delta) < 20) return null;         // magnitud mínima
  if (delta > 0) {
    return `Llevas ${num(kmAhora)} km esta semana, un ${Math.round(delta)} % por encima de tu media de 4 semanas.`;
  }
  return `Semana suave: ${num(kmAhora)} km frente a los ${num(media4)} km de media — hay margen para otra salida.`;
}

/**
 * «4 semanas seguidas corriendo al menos una vez.»
 * Guardas: racha ≥3 semanas (contada hacia atrás; la semana en curso puede
 * estar aún vacía sin romperla).
 */
function tplRacha(data) {
  const runs = carreras(data);
  if (runs.length < 3) return null;
  const semanas = new Set(runs.map((r) => isoWeekKey(r.date)));
  const hoy = refHoy(data);
  let racha = 0;
  let i = semanas.has(isoWeekKey(hoy)) ? 0 : 1; // la semana en curso no rompe la racha
  for (; i < 260; i++) {
    if (semanas.has(isoWeekKey(isoAddDays(hoy, -7 * i)))) racha++;
    else break;
  }
  if (racha < 3) return null;
  return `${racha} semanas seguidas corriendo al menos una vez — la constancia es la base.`;
}

/* ---------- Plantillas de HOY (estado del día) ---------- */

/** Frescura: si los datos del reloj no son de hoy/ayer, avisar sin inventar.
 *  El atraso se mide contra la fecha REAL (isoToday), no contra meta.updated:
 *  el pipeline escribe daily y meta el mismo día, así que compararlos entre sí
 *  daría siempre ~0 y esta guarda jamás dispararía con datos congelados.
 *  Además, al ir primera bloquea las plantillas de HOY en presente (§6.6),
 *  coherente con el semáforo (today.js usa isoToday). */
function tplHoyFrescura(data) {
  const d = dias(data);
  if (!d.length) return null;
  const atraso = diffDias(d[d.length - 1].date, isoToday());
  if (atraso <= 1) return null;
  return `Los datos del reloj tienen ${atraso} días — tómate el semáforo con cautela y decide por sensaciones.`;
}

/** Fiesta anoche + HRV bajo: la combinación que pide descanso. */
function tplHoyFiesta(data) {
  const d = dias(data);
  if (!d.length) return null;
  const hoy = d[d.length - 1];
  if (hoy.party !== true) return null;
  const low = data?.status?.hrv_baseline?.balancedLow;
  if (fin(hoy.hrv) && fin(low) && hoy.hrv < low) {
    return `Noche de fiesta y HRV en ${hoy.hrv} ms, por debajo de tu banda: hoy toca descansar de verdad.`;
  }
  return 'Anoche hubo fiesta: si sales, que sea corto, suave y con agua.';
}

/** HRV por debajo de la banda personal. */
function tplHoyHrvBajo(data) {
  const d = dias(data);
  if (!d.length) return null;
  const hoy = d[d.length - 1];
  const low = data?.status?.hrv_baseline?.balancedLow;
  if (!fin(hoy.hrv) || !fin(low) || hoy.hrv >= low) return null;
  return `HRV en ${hoy.hrv} ms, por debajo de tu banda (${low}+): escucha al cuerpo y suaviza o descansa.`;
}

/** Sueño muy corto anoche. */
function tplHoySuenoCorto(data) {
  const d = dias(data);
  if (!d.length) return null;
  const hoy = d[d.length - 1];
  if (!fin(hoy.sleep_hours) || hoy.sleep_hours >= 5.5) return null;
  return `Solo ${num(hoy.sleep_hours)} h de sueño anoche — si corres, que sea corto y bien por debajo de 142.`;
}

/** Todo en orden: HRV en banda (+ carga baja si el ratio Garmin lo confirma). */
function tplHoyVerde(data) {
  const d = dias(data);
  if (!d.length) return null;
  const hoy = d[d.length - 1];
  const b = data?.status?.hrv_baseline;
  if (!fin(hoy.hrv) || !fin(b?.balancedLow) || !fin(b?.balancedUpper)) return null;
  if (hoy.hrv < b.balancedLow || hoy.hrv > b.balancedUpper) return null;
  const a = data?.status?.acute_load;
  const c = data?.status?.chronic_load;
  const cargaBaja = fin(a) && fin(c) && c > 0 && a / c < 0.8;
  const coda = cargaBaja ? ' y la carga aguda está muy baja: hoy toca salir' : '';
  return `HRV en ${hoy.hrv} ms, dentro de tu banda ${b.balancedLow}–${b.balancedUpper}${coda} — buen día para rodar en Z2.`;
}

/* ---------- Plantillas de RECUPERACIÓN ---------- */

/** HRV semanal vs banda personal (media de los últimos 7 días con dato). */
function tplRecupHrv(data) {
  const d = dias(data);
  const b = data?.status?.hrv_baseline;
  if (!fin(b?.balancedLow) || !fin(b?.balancedUpper)) return null;
  const ult7 = d.slice(-7).map((x) => x.hrv).filter(fin);
  if (ult7.length < 4) return null;              // n mínimo
  const m = media(ult7);
  if (!fin(m)) return null;
  if (m < b.balancedLow) {
    return `Tu HRV medio de la última semana (${Math.round(m)} ms) está por debajo de tu banda ${b.balancedLow}–${b.balancedUpper}: prioriza dormir.`;
  }
  if (m > b.balancedUpper) return null;          // fuera por arriba: sin plantilla fiable
  return `HRV medio de la última semana: ${Math.round(m)} ms, estable dentro de tu banda ${b.balancedLow}–${b.balancedUpper}.`;
}

/** Sueño medio semanal por debajo de lo razonable. */
function tplRecupSueno(data) {
  const d = dias(data);
  const ult7 = d.slice(-7).map((x) => x.sleep_hours).filter(fin);
  if (ult7.length < 4) return null;              // n mínimo
  const m = media(ult7);
  if (!fin(m) || m >= 6) return null;            // magnitud mínima del déficit
  return `Duermes ${num(m)} h de media esta semana — la adaptación al entrenamiento se fabrica durmiendo.`;
}

/* ---------- Plantillas de RECUPERACIÓN · Body Battery (fase 3) ---------- */
/* daily.bb_high = pico diario de Body Battery (0–100), alcanzado tras la
   recarga nocturna. Son datos DERIVADOS de Garmin, nunca inventados aquí. */

/**
 * «Tu pico diario de Body Battery baja de 72 a 61 de media semanal.»
 * Guardas: ≥14 días con bb_high (dos ventanas de 7 con dato), cambio ≥8
 * puntos (menos es vaivén normal del día a día) y FRESCURA: «esta semana»
 * habla en presente — con datos congelados >1 día mentiría (§6.6).
 */
function tplRecupBbTendencia(data) {
  const d = dias(data).filter((x) => fin(x.bb_high));
  if (d.length < 14) return null;                // n mínimo: 7 + 7 con dato
  if (diffDias(d[d.length - 1].date, isoToday()) > 1) return null; // frescura
  const ult = media(d.slice(-7).map((x) => x.bb_high));
  const prev = media(d.slice(-14, -7).map((x) => x.bb_high));
  if (!fin(ult) || !fin(prev)) return null;
  const delta = ult - prev;
  if (Math.abs(delta) < 8) return null;          // magnitud mínima: 8 puntos
  if (delta > 0) {
    return `Tu pico diario de Body Battery sube: media de ${Math.round(ult)} esta semana frente a ${Math.round(prev)} la anterior — la recarga nocturna mejora.`;
  }
  return `Tu pico diario de Body Battery baja de ${Math.round(prev)} a ${Math.round(ult)} de media semanal — vigila sueño y estrés antes de apretar.`;
}

/**
 * «5 noches seguidas recargando la Body Battery a 80 o más.» / «Solo 3 de
 * tus últimas 14 noches han recargado la Body Battery a 80.»
 * Dos ramas EXCLUYENTES de la misma señal (nunca se pintan a la vez):
 * racha buena (≥3 noches seguidas a 80+) o déficit claro (≤4 de las últimas
 * 14 noches). La zona intermedia calla: no hay nada afirmable con confianza.
 * Guardas: ≥14 días con bb_high y frescura ≤1 día («noches seguidas» y
 * «últimas noches» hablan del presente).
 */
function tplRecupBb80(data) {
  const d = dias(data).filter((x) => fin(x.bb_high));
  if (d.length < 14) return null;                // n mínimo para ambas ramas
  if (diffDias(d[d.length - 1].date, isoToday()) > 1) return null; // frescura
  let racha = 0;
  for (let i = d.length - 1; i >= 0 && d[i].bb_high >= 80; i--) racha++;
  if (racha >= 3) {
    return `${racha} noches seguidas recargando la Body Battery a 80 o más — el descanso está haciendo su trabajo.`;
  }
  const noches80 = d.slice(-14).filter((x) => x.bb_high >= 80).length;
  if (noches80 > 4) return null;                 // sin déficit claro → silencio
  if (noches80 === 0) {
    return 'Ninguna de tus últimas 14 noches ha recargado la Body Battery a 80 — prioriza dormir antes que sumar kilómetros.';
  }
  return `Solo ${noches80} de tus últimas 14 noches han recargado la Body Battery a 80 — prioriza dormir antes que sumar kilómetros.`;
}

/* ==========================================================================
   PLANTILLAS DE SALUD (§5 spec salud 2026-09-22) — todas sobre health.json /
   trends.json, ficheros OPCIONALES: sin ellos, cada plantilla devuelve null
   sin lanzar y el insight cae al siguiente eslabón o al fallback neutro.

   REGLA ANTI-TAUTOLOGÍA (§1.3/§5): PROHIBIDO presentar como hallazgo la
   correlación entre una métrica y sus propios insumos algorítmicos
   (sueño→readiness, estrés→readiness, temperatura→sweatLoss). Ninguna
   plantilla de este bloque cruza esas parejas: cada una habla de UNA métrica
   contra sí misma en el tiempo, contra el propio historial (percentil) o
   contra una referencia externa fija (150 min OMS, edad real).
   ========================================================================== */

/* ---------- HOY (amplían insightHoy) ---------- */

/**
 * «Llevas N días con readiness ≥70.»
 * Guardas (§5): racha ≥3 días CONSECUTIVOS con dato y score ≥70; frescura <2d
 * (el último dato es de hoy o de ayer: «llevas» habla en presente).
 */
function tplHoyRachaReadiness(data) {
  const h = saludDias(data).filter((x) => fin(x.readiness_score));
  if (!h.length) return null;
  const ult = h[h.length - 1];
  if (diffDias(ult.date, isoToday()) >= 2) return null; // frescura <2d
  if (ult.readiness_score < 70) return null;
  let racha = 1;
  for (let i = h.length - 2; i >= 0; i--) {
    // Días naturales consecutivos CON dato; un hueco corta la racha.
    if (h[i].date !== isoAddDays(h[i + 1].date, -1)) break;
    if (h[i].readiness_score < 70) break;
    racha++;
  }
  if (racha < 3) return null;
  return `Llevas ${racha} días con readiness ≥70 — racha de buena recuperación según Garmin.`;
}

/**
 * «Tu FC en reposo de hoy está en tu p10 de 90 días.»
 * Percentil PERSONAL vía percentileRank (§5, injerto Atlas corregido): ventana
 * móvil de los últimos 90 días naturales CON dato, no el histórico completo.
 * Guardas (§5): n≥60 en la ventana; dato de hoy o ayer; percentil ≤15 o ≥85.
 * Presentación en tinta (texto): el color de estado no existe en este módulo.
 */
function tplHoyRhrPercentil(data) {
  const h = saludDias(data).filter((x) => fin(x.rhr));
  if (!h.length) return null;
  const ult = h[h.length - 1];
  const atraso = diffDias(ult.date, isoToday());
  if (atraso > 1) return null;                   // dato de hoy o ayer
  const desde = isoAddDays(ult.date, -89);       // ventana: 90 días naturales
  const ventana = h.filter((x) => x.date >= desde).map((x) => x.rhr);
  const res = percentileRank(ventana, ult.rhr);
  if (!res || res.n < 60) return null;           // guarda n≥60 (métrica diaria)
  if (res.pct > 15 && res.pct < 85) return null; // solo extremos afirmables
  const p = Math.round(res.pct);
  const cuando = atraso === 0 ? 'de hoy' : 'de ayer';
  const rumbo = res.pct <= 15 ? 'más baja de lo habitual en ti' : 'más alta de lo habitual en ti';
  return `Tu FC en reposo ${cuando} (${Math.round(ult.rhr)} lpm) está en tu p${p} de 90 días — ${rumbo}.`;
}

/* ---------- ENTRENAR ---------- */

/**
 * «Garmin estima tu 5K en 31:03, X min menos que hace un mes.»
 * Guardas (§5): snapshots de trends.json cubriendo ≥28 días y Δ≥60 s frente
 * al snapshot más reciente con ≥28 días de antigüedad. Si el tiempo EMPEORA
 * también se dice (honestidad), con la misma magnitud mínima.
 */
function tplEntrenarPred5k(data) {
  const t = tendencias(data).filter((x) => fin(x.pred_5k_s) && x.pred_5k_s > 0);
  if (t.length < 2) return null;
  const ult = t[t.length - 1];
  if (diffDias(t[0].date, ult.date) < 28) return null; // serie aún en construcción
  const limite = isoAddDays(ult.date, -28);
  let base = null;
  for (let i = t.length - 2; i >= 0; i--) {
    if (t[i].date <= limite) { base = t[i]; break; } // el más reciente ≥28d atrás
  }
  if (!base) return null;
  const delta = base.pred_5k_s - ult.pred_5k_s;      // >0 = mejora
  if (Math.abs(delta) < 60) return null;             // magnitud mínima: 60 s
  const min = num(Math.abs(delta) / 60, 1);
  const rumbo = delta > 0 ? 'menos' : 'más';
  return `Garmin estima tu 5K en ${fmtDur(ult.pred_5k_s)}, ${min} min ${rumbo} que hace un mes.`;
}

/* ---------- RECUPERAR ---------- */

/**
 * «Tu estrés medio de [mes] (X) supera al de [mes-1] (Y).»
 * Guardas (§5): ≥21 días con dato en CADA mes y Δ≥5 puntos; solo meses
 * naturales consecutivos. Nombra los meses explícitamente → la frase sigue
 * siendo cierta aunque los datos envejezcan (sin guarda de frescura, como
 * tplZ2Meses). Si el estrés BAJA también se cuenta (misma magnitud).
 */
function tplRecupEstresMeses(data) {
  const h = saludDias(data).filter((x) => fin(x.stress_avg));
  if (h.length < 42) return null;                // n mínimo global (21 + 21)
  const porM = new Map();
  for (const x of h) {
    const k = x.date.slice(0, 7);
    if (!porM.has(k)) porM.set(k, []);
    porM.get(k).push(x.stress_avg);
  }
  const meses = [...porM.entries()].filter(([, v]) => v.length >= 21);
  if (meses.length < 2) return null;
  const [k0, v0] = meses[meses.length - 2];
  const [k1, v1] = meses[meses.length - 1];
  const sep = (+k1.slice(0, 4) - +k0.slice(0, 4)) * 12 + (+k1.slice(5, 7) - +k0.slice(5, 7));
  if (sep !== 1) return null;                    // solo meses consecutivos
  const m0 = media(v0);
  const m1 = media(v1);
  if (!fin(m0) || !fin(m1)) return null;
  if (Math.abs(m1 - m0) < 5) return null;        // magnitud mínima: 5 puntos
  const n0 = mesLargo(`${k0}-01`);
  const n1 = mesLargo(`${k1}-01`);
  if (!n0 || !n1) return null;
  if (m1 > m0) {
    return `Tu estrés medio de ${n1} (${Math.round(m1)}) supera al de ${n0} (${Math.round(m0)}) — vigila la recuperación fuera del entrenamiento.`;
  }
  return `Tu estrés medio de ${n1} (${Math.round(m1)}) baja frente al de ${n0} (${Math.round(m0)}).`;
}

/* ---------- CUERPO ---------- */

/**
 * Aviso de SpO2 sostenida (§5, wording médico prudente §8.1): SOLO con media
 * de sueño <90 % durante ≥7 días naturales CONSECUTIVOS con dato — nunca por
 * un mínimo aislado (el 79 del sondeo es casi seguro artefacto de postura).
 * Frase fija del spec, sin cifras alarmistas y JAMÁS en rojo (aquí solo texto).
 * Frescura ≤2d: «si se mantiene» habla del presente.
 */
function tplCuerpoSpo2Sostenida(data) {
  const h = saludDias(data).filter((x) => fin(x.spo2_sleep));
  if (h.length < 7) return null;
  const ult = h[h.length - 1];
  if (diffDias(ult.date, isoToday()) > 2) return null;
  let racha = 0;
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].spo2_sleep >= 90) break;
    if (racha > 0 && h[i + 1].date !== isoAddDays(h[i].date, 1)) break; // consecutivos
    racha++;
  }
  if (racha < 7) return null;                    // persistencia mínima: 7 días
  return 'Media de sueño baja sostenida: el sensor de muñeca puede infravalorar; coméntalo con tu médico si se mantiene.';
}

/**
 * «Tu RHR lleva ≥3 días ≥5 lpm sobre tu media de 30 días — posible fatiga o
 * incubando algo.»
 * Guardas (§5): Δ≥5 lpm y ≥3 días naturales CONSECUTIVOS, cada uno comparado
 * contra la media de SUS 30 días previos con dato (≥20 de 30 para que la base
 * sea juzgable). Frescura ≤1d: «lleva» habla en presente.
 */
function tplCuerpoRhrElevada(data) {
  const h = saludDias(data).filter((x) => fin(x.rhr));
  if (h.length < 23) return null;                // base 20 + racha 3, mínimo
  if (diffDias(h[h.length - 1].date, isoToday()) > 1) return null; // frescura
  let racha = 0;
  for (let i = h.length - 1; i >= 0; i--) {
    if (racha > 0 && h[i + 1].date !== isoAddDays(h[i].date, 1)) break; // consecutivos
    const desde = isoAddDays(h[i].date, -30);
    const prev = [];
    for (let j = i - 1; j >= 0 && h[j].date >= desde; j--) prev.push(h[j].rhr);
    if (prev.length < 20) break;                 // base insuficiente para juzgar
    const m30 = media(prev);
    if (!fin(m30) || h[i].rhr - m30 < 5) break;  // magnitud mínima: 5 lpm
    racha++;
  }
  if (racha < 3) return null;
  return `Tu RHR lleva ${racha} días ≥5 lpm sobre tu media de 30 días — posible fatiga o incubando algo.`;
}

/**
 * «Semana pasada: X/150 min de intensidad (recomendación OMS).»
 * Factual (§5); minutos PONDERADOS como cuentan Garmin y la OMS
 * (moderados + 2×vigorosos). Guardas: frescura <7d y ≥5 días de la semana
 * pasada con dato de intensidad (una semana a medio registrar mentiría).
 */
function tplCuerpoIntensidadOms(data) {
  const h = saludDias(data);
  if (!h.length) return null;
  if (diffDias(h[h.length - 1].date, isoToday()) >= 7) return null; // frescura <7d
  const semPasada = isoWeekKey(isoAddDays(isoToday(), -7));
  const filas = h.filter((x) => isoWeekKey(x.date) === semPasada &&
    (fin(x.intensity_mod) || fin(x.intensity_vig)));
  if (filas.length < 5) return null;             // semana suficientemente registrada
  const total = filas.reduce((a, x) => a +
    (fin(x.intensity_mod) ? x.intensity_mod : 0) +
    2 * (fin(x.intensity_vig) ? x.intensity_vig : 0), 0);
  return `Semana pasada: ${Math.round(total)}/150 min de intensidad (recomendación OMS).`;
}

/**
 * «Tu edad fitness (28,1) ya es menor que tu edad real (29).»
 * Factual (§5): del último snapshot de trends.json, solo si de verdad es
 * menor y con frescura <7d. Sin dirección inversa: si no es menor, silencio
 * (no hay frase prudente equivalente que no suene a regañina).
 */
function tplCuerpoEdadFitness(data) {
  const t = tendencias(data).filter((x) => fin(x.fitness_age) && fin(x.chrono_age));
  if (!t.length) return null;
  const ult = t[t.length - 1];
  if (diffDias(ult.date, isoToday()) >= 7) return null; // frescura <7d
  if (ult.fitness_age >= ult.chrono_age) return null;
  return `Tu edad fitness (${num(ult.fitness_age)}) ya es menor que tu edad real (${ult.chrono_age}).`;
}

/* ---------- HOY (KPI): acuerdo semáforo ↔ Garmin ---------- */

/**
 * Veredicto PROPIO de un día histórico (0=verde, 1=ámbar, 2=rojo), réplica
 * pura de las reglas (2)(3)(4)(6)(6b) del semáforo de today.js aplicadas a la
 * fila i de daily. La regla (1) frescura no aplica a días pasados (cada día
 * fue «fresco» para sí mismo) y la (5) ACWR solo añade motivo, nunca color.
 * Supuestos documentados: la banda HRV es la ACTUAL de status.json (Garmin no
 * expone baselines históricas) y un día sin HRV (con lookback de 3 días, como
 * today.js) NI sueño no es evaluable → null (verde por ignorancia mentiría).
 */
function veredictoPropioDia(diasArr, i, bLow) {
  const fila = diasArr[i];
  let hrv = null;
  for (let j = i; j >= 0 && j >= i - 3; j--) {
    if (fin(diasArr[j].hrv)) { hrv = diasArr[j].hrv; break; }
  }
  const tieneSueno = fin(fila.sleep_score) || fin(fila.sleep_hours);
  if (hrv === null && !tieneSueno) return null;  // día no evaluable
  let nivel = 0;
  const hrvBajo = hrv !== null && bLow !== null && hrv < bLow;
  if (hrvBajo) nivel = 1;                                        // (2)
  if ((fin(fila.sleep_score) && fila.sleep_score < 60) ||
      (fin(fila.sleep_hours) && fila.sleep_hours < 5)) {
    nivel = Math.max(nivel, 1);                                  // (3)
  }
  if (fila.party === true) nivel = hrvBajo ? 2 : Math.max(nivel, 1); // (4)
  const prev = i > 0 && diasArr[i - 1].date === isoAddDays(fila.date, -1)
    ? diasArr[i - 1] : null;
  if (prev && fin(prev.bb_charged) && fin(prev.bb_drained) &&
      prev.bb_charged - prev.bb_drained <= -20) {
    nivel = Math.max(nivel, 1);                                  // (6)
  }
  if (fin(fila.bb_high) && fila.bb_high < 40) nivel = Math.max(nivel, 1); // (6b)
  return nivel;
}

/* ---------- Plantilla de ARCHIVO ---------- */

/** Totales del histórico (+ fuerza si la hay). Guardas: ≥5 carreras. */
function tplArchivoTotales(data) {
  const runs = carreras(data).filter((r) => fin(r.km));
  if (runs.length < 5) return null;
  const kmTotal = runs.reduce((a, r) => a + r.km, 0);
  const desde = mesLargo(runs[0].date);
  if (!fin(kmTotal) || !desde) return null;
  let fuerza = '';
  if (esArray(data?.allActivities)) {
    const n = data.allActivities.filter((a) => a?.type === 'strength_training').length;
    if (n >= 3) fuerza = ` (y ${n} sesiones de fuerza)`;
  }
  return `${runs.length} carreras y ${num(kmTotal)} km desde ${desde}${fuerza} — cada celda del archivo es una salida hecha.`;
}

/* ---------- Plantilla mensual (variante para PROGRESO) ---------- */

/** Reformulación del ritmo-a-igual-FC para no repetir literal el del header. */
function tplProgresoMeses(data) {
  const runs = carreras(data).filter((r) => fin(r.pace_s) && fin(r.hr));
  if (runs.length < 8) return null;
  const meses = [...porMes(runs).entries()].filter(([, rs]) => rs.length >= 3);
  if (meses.length < 2) return null;
  const [k0, rs0] = meses[0];
  const [k1, rs1] = meses[meses.length - 1];
  const sep = (+k1.slice(0, 4) - +k0.slice(0, 4)) * 12 + (+k1.slice(5, 7) - +k0.slice(5, 7));
  if (sep < 2) return null;
  const pace0 = media(rs0.map((r) => r.pace_s));
  const pace1 = media(rs1.map((r) => r.pace_s));
  const hr0 = media(rs0.map((r) => r.hr));
  const hr1 = media(rs1.map((r) => r.hr));
  if (![pace0, pace1, hr0, hr1].every(fin)) return null;
  if (hr0 - hr1 < 4 || pace1 > pace0 * 1.03) return null;
  const m0 = mesCorto(`${k0}-01`);
  const m1 = mesCorto(`${k1}-01`);
  if (!m0 || !m1) return null;
  return `Mismo ritmo, menos esfuerzo: ${m0} ${paceFmt(pace0)}/km @ ${Math.round(hr0)} ppm → ${m1} ${paceFmt(pace1)}/km @ ${Math.round(hr1)} ppm.`;
}

/* ==========================================================================
   EXPORTS — una función por acto + insight del día (contrato §4.7)
   ========================================================================== */

/** Header #insightDia — la mejor frase disponible del cuaderno. */
export function insightDelDia(data) {
  return primera(
    [tplRitmoIgualFc, tplEfZ2, tplKmSemana, tplRacha],
    data,
    'Semana tranquila — los datos siguen acumulándose.',
  );
}

/** Pestaña HOY (#insightHoy) — estado del día, sin inventar Body Battery.
 *  AMPLIADA (§5 spec salud): percentil personal de RHR y racha de readiness.
 *  Prioridad: frescura > avisos (fiesta, HRV, sueño) > RHR fuera de lo
 *  habitual (p≤15/p≥85: lo específico manda) > racha readiness > verde
 *  genérico. Fallback neutro INTACTO. */
export function insightHoy(data) {
  return primera(
    [tplHoyFrescura, tplHoyFiesta, tplHoyHrvBajo, tplHoySuenoCorto,
      tplHoyRhrPercentil, tplHoyRachaReadiness, tplHoyVerde],
    data,
    'Día normal: decide por sensaciones y mantén la FC por debajo de 142.',
  );
}

/** Acto 2 · ESTA SEMANA (#insightSemana).
 *  La racha viva de disciplina Z2 entra tras el volumen: si la semana no da
 *  titular de kilómetros, una racha en curso es la mejor noticia semanal. */
export function insightSemana(data) {
  return primera(
    [tplKmSemana, tplZ2RachaViva, tplRacha],
    data,
    'Semana tranquila — los datos siguen acumulándose.',
  );
}

/** Acto 3 · PROGRESO (#insightProgreso). */
export function insightProgreso(data) {
  return primera(
    [tplEfZ2, tplProgresoMeses],
    data,
    'El progreso aeróbico es lento por diseño — constancia sobre intensidad.',
  );
}

/** Acto 4 · INTENSIDAD Y TÉCNICA (#insightIntensidad).
 *  Prioridad: cambio reciente (5v5) > cambio mensual > mejor del mes >
 *  foto global (FC media) > cadencia. Lo nuevo y específico manda; el conteo
 *  global queda de red de seguridad (su cifra ya vive en el KPI de zonas).
 *  NOTA fase 3: se DESCARTARON los cruces pct_z2×temp_c y pct_z2×EF — con
 *  los 34 puntos actuales |r|<0,3 (0,21 y −0,29): correlación insuficiente
 *  para afirmar nada sin mentir (§6.6). Reevaluar con más histórico. */
export function insightIntensidad(data) {
  return primera(
    [tplZ2Tendencia5, tplZ2Meses, tplZ2MejorMes, tplDisciplinaZ2, tplGapCadencia],
    data,
    'Rueda suave y deja que la técnica llegue con los kilómetros.',
  );
}

/** Acto 5 · RECUPERACIÓN (#insightRecuperacion).
 *  Prioridad: déficit de sueño (lo más accionable) > movimientos de Body
 *  Battery (fase 3) > HRV semanal como cierre informativo.
 *  NOTA fase 3: statusHistory NO alimenta plantillas todavía — con 1–2
 *  puntos cualquier «tendencia» de VO2max/carga sería inventada; se añadirá
 *  cuando el histórico acumule ≥14 puntos reales. */
export function insightRecuperacion(data) {
  return primera(
    [tplRecupSueno, tplRecupBbTendencia, tplRecupBb80, tplRecupHrv],
    data,
    'Recuperación sin señales de alarma — sigue cuidando el sueño.',
  );
}

/** Acto 6 · ARCHIVO (#insightArchivo). */
export function insightArchivo(data) {
  return primera(
    [tplArchivoTotales],
    data,
    'El archivo se irá llenando salida a salida.',
  );
}

/* ---------- Exports NUEVOS por pestaña (§4.7 INTERFACES, §5 spec salud) ----------
   app.js pinta con cadena de fallback («primera función existente que
   devuelva texto»): por eso insightEntrenar/insightRecuperar devuelven ''
   cuando su plantilla no pasa — así el hueco lo llena el insight rico de
   siempre (insightSemana / insightRecuperacion) en vez de un neutro pobre.
   insightCuerpo no tiene sucesor en la cadena («→ (vacío)») → fallback
   neutro propio. */

/** Pestaña ENTRENAR (#insightEntrenar): predicción 5K vs hace un mes.
 *  '' mientras trends.json no acumule ≥28 días (cadena → insightSemana). */
export function insightEntrenar(data) {
  return primera([tplEntrenarPred5k], data, '');
}

/** Pestaña RECUPERAR (#insightRecuperar): estrés medio mes vs mes anterior.
 *  '' sin health.json o sin 2 meses con base (cadena → insightRecuperacion). */
export function insightRecuperar(data) {
  return primera([tplRecupEstresMeses], data, '');
}

/** Pestaña CUERPO (#insightCuerpo). Prioridad: SpO2 sostenida (la señal más
 *  seria y más rara) > RHR elevada (fatiga) > minutos OMS (factual semanal) >
 *  edad fitness (factual estable). Sin health/trends → fallback neutro. */
export function insightCuerpo(data) {
  return primera(
    [tplCuerpoSpo2Sostenida, tplCuerpoRhrElevada, tplCuerpoIntensidadOms,
      tplCuerpoEdadFitness],
    data,
    'Constantes sin señales llamativas — el cuaderno sigue observando.',
  );
}

/** KPI de HOY «semáforo y Garmin coinciden N de M días» (§5 fila 9, §2.1).
 *  Cálculo PURO para #kpiAcuerdo: lo pinta today.js (C1, contrato §4.1);
 *  este export existe para que no haya dos aritméticas del acuerdo.
 *  Mapa (§2.1): verde↔HIGH/PRIME · ámbar↔MODERATE · rojo↔LOW. M = días con
 *  AMBOS veredictos (nivel Garmin mapeado + día propio evaluable).
 *  Guarda n≥20 o '' (la card no pinta nada). JAMÁS lanza. */
export function kpiAcuerdo(data) {
  try {
    const d = dias(data);
    const h = saludDias(data).filter((x) => typeof x.readiness_level === 'string');
    if (!d.length || !h.length) return '';
    const b = data?.status?.hrv_baseline;
    const bLow = fin(b?.balancedLow) ? b.balancedLow : null;
    const idxPorFecha = new Map(d.map((x, i) => [x.date, i]));
    const MAPA = { HIGH: 0, PRIME: 0, MODERATE: 1, LOW: 2 };
    let m = 0;
    let coinciden = 0;
    for (const x of h) {
      const garmin = MAPA[x.readiness_level];
      if (garmin === undefined) continue;        // nivel no mapeado: fuera
      const i = idxPorFecha.get(x.date);
      if (i === undefined) continue;
      const propio = veredictoPropioDia(d, i, bLow);
      if (propio === null) continue;             // día propio no evaluable
      m++;
      if (propio === garmin) coinciden++;
    }
    if (m < 20) return '';                       // guarda n≥20 (§5)
    return `Semáforo y Garmin coinciden ${coinciden} de ${m} días.`;
  } catch {
    return '';
  }
}
