/**
 * Dashboard Running — Alejandro
 * Task 7: Data load, range filter, cards, charts.
 * Interactive features (drill-down modal, scatter, heatmap, today panel) → Task 8.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Chart.js global defaults  (dark theme)
// ─────────────────────────────────────────────────────────────────────────────
Chart.defaults.color = "#8b97a8";
Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";
Chart.defaults.font.size = 11;
const GRID = "#222b3a";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const paceFmt = (s) =>
  Math.floor(s / 60) + ":" + String(Math.round(s % 60)).padStart(2, "0");

const fmtDate = (isoStr) => {
  const d = new Date(isoStr);
  return (
    String(d.getDate()).padStart(2, "0") +
    "/" +
    String(d.getMonth() + 1).padStart(2, "0")
  );
};

const fmtDatetime = (isoStr) => {
  const d = new Date(isoStr);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
};

/** Format duration seconds → "mm:ss" or "h:mm:ss" */
const fmtDur = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

/** Format total seconds → "Xh Ym" */
const fmtTotalTime = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
};

/** Return "YYYY-MM" for a date string */
const ym = (dateStr) => dateStr.slice(0, 7);

/** Moving average over an array (window = n items) */
const movingAvg = (arr, n) =>
  arr.map((_, i) => {
    const window = arr.slice(Math.max(0, i - n + 1), i + 1);
    return +(window.reduce((a, v) => a + v, 0) / window.length).toFixed(2);
  });

// ─────────────────────────────────────────────────────────────────────────────
// Chart registry — keeps references so we can destroy before re-render
// ─────────────────────────────────────────────────────────────────────────────
const chartRegistry = {};

function destroyChart(id) {
  if (chartRegistry[id]) {
    chartRegistry[id].destroy();
    delete chartRegistry[id];
  }
}

function registerChart(id, instance) {
  chartRegistry[id] = instance;
  return instance;
}

// ─────────────────────────────────────────────────────────────────────────────
// Range state
// ─────────────────────────────────────────────────────────────────────────────
let rangeDays = null; // null = all

function inRange(dateStr) {
  if (rangeDays === null) return true;
  const now = new Date();
  const d = new Date(dateStr);
  const diffMs = now - d;
  return diffMs >= 0 && diffMs <= rangeDays * 86400 * 1000;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level data stores (populated after fetch)
// ─────────────────────────────────────────────────────────────────────────────
let runs = [];
let daily = [];
let status = {};
let allActivities = [];
let runsDetail = {};
let meta = {};

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const [runsRes, dailyRes, statusRes, allActRes, detailRes, metaRes] =
      await Promise.all([
        fetch("data/runs.json"),
        fetch("data/daily.json"),
        fetch("data/status.json"),
        fetch("data/all_activities.json"),
        fetch("data/runs_detail.json"),
        fetch("data/meta.json"),
      ]);

    [runs, daily, status, allActivities, runsDetail, meta] = await Promise.all([
      runsRes.json(),
      dailyRes.json(),
      statusRes.json(),
      allActRes.json(),
      detailRes.json(),
      metaRes.json(),
    ]);

    // Header: updated timestamp
    const updatedEl = document.getElementById("updated");
    if (updatedEl && meta.updated) {
      updatedEl.textContent = fmtDatetime(meta.updated);
    }

    // Footer: date range
    const footRangeEl = document.getElementById("footRange");
    if (footRangeEl && meta.first_date) {
      footRangeEl.textContent = `${fmtDate(meta.first_date)} → hoy`;
    }

    // Wire range buttons
    document.querySelectorAll(".range-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document
          .querySelectorAll(".range-btn")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const val = btn.dataset.days;
        rangeDays = val === "all" ? null : Number(val);
        renderAll();
      });
    });

    renderAll();
  } catch (err) {
    console.error("Dashboard init error:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// renderAll — central re-render (called on range change)
// ─────────────────────────────────────────────────────────────────────────────
function renderAll() {
  const fRuns = runs.filter((r) => inRange(r.date));
  const fDaily = daily.filter((d) => inRange(d.date));

  renderCards(fRuns);
  renderDist(fRuns);
  renderPaceHr(fRuns);
  renderMaxHr(fRuns);
  renderMonthly(); // always uses full data
  renderEF();      // Task 8 stub
  renderHrv(fDaily);
  renderSleep(fDaily);
  renderBB(fDaily);
  renderLoad();
  renderCadence(fRuns);
  renderWeight(fDaily);
  renderRunsTable(fRuns);

  // Task 8 stubs
  renderScatter();
  renderHeatmap();
  renderToday();
}

// ─────────────────────────────────────────────────────────────────────────────
// CARDS
// ─────────────────────────────────────────────────────────────────────────────
function renderCards(fRuns) {
  // Total km
  const totalKm = fRuns.reduce((a, r) => a + r.km, 0);
  setText("cardKm", totalKm.toFixed(1) + " km");

  // Nº carreras
  setText("cardRuns", fRuns.length);

  // Total time
  const totalSec = fRuns.reduce((a, r) => a + r.dur_s, 0);
  setText("cardTime", fmtTotalTime(totalSec));

  // VO2max (always from status snapshot)
  setText("cardVo2", status.vo2max != null ? status.vo2max.toFixed(1) : "—");

  // Streak: runs in last 28 days / 4 (use full runs list, not range-filtered)
  const now = new Date();
  const runs28 = runs.filter((r) => {
    const diff = now - new Date(r.date);
    return diff >= 0 && diff <= 28 * 86400 * 1000;
  });
  setText("cardStreak", (runs28.length / 4).toFixed(1) + "/sem");

  // This month vs previous month (use full runs list)
  const todayStr = new Date().toISOString().slice(0, 10);
  const curYM = todayStr.slice(0, 7);
  const prevDate = new Date();
  prevDate.setDate(1);
  prevDate.setMonth(prevDate.getMonth() - 1);
  const prevYM =
    prevDate.getFullYear() +
    "-" +
    String(prevDate.getMonth() + 1).padStart(2, "0");

  const kmCur = runs
    .filter((r) => ym(r.date) === curYM)
    .reduce((a, r) => a + r.km, 0);
  const kmPrev = runs
    .filter((r) => ym(r.date) === prevYM)
    .reduce((a, r) => a + r.km, 0);
  setText("cardMonth", `${kmCur.toFixed(1)} vs ${kmPrev.toFixed(1)} km`);
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART 1: Distancia por carrera (bars + 4-run MA line)
// MA is computed on FULL runs list; then we slice/align for the filtered range.
// ─────────────────────────────────────────────────────────────────────────────
function renderDist(fRuns) {
  destroyChart("dist");
  if (!fRuns.length) return;

  // Compute MA on the full sorted runs list
  const sortedAll = [...runs].sort((a, b) => a.date.localeCompare(b.date));
  const maFull = movingAvg(sortedAll.map((r) => r.km), 4);
  // Build a map id → ma value
  const maById = {};
  sortedAll.forEach((r, i) => (maById[r.id] = maFull[i]));

  const sorted = [...fRuns].sort((a, b) => a.date.localeCompare(b.date));
  const labels = sorted.map((r) => fmtDate(r.date));
  const kmData = sorted.map((r) => r.km);
  const maData = sorted.map((r) => maById[r.id] ?? null);

  registerChart(
    "dist",
    new Chart(document.getElementById("dist"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "km",
            data: kmData,
            backgroundColor: "#4dd0a644",
            borderColor: "#4dd0a6",
            borderWidth: 1.5,
            borderRadius: 5,
          },
          {
            label: "media móvil (4)",
            data: maData,
            type: "line",
            borderColor: "#5b9cf6",
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.35,
          },
        ],
      },
      options: {
        plugins: { legend: { display: true } },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { color: GRID },
            title: { display: true, text: "km" },
          },
        },
      },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART 2: Ritmo vs FC media (dual axis)
// ─────────────────────────────────────────────────────────────────────────────
function renderPaceHr(fRuns) {
  destroyChart("pacehr");
  if (!fRuns.length) return;

  const sorted = [...fRuns].sort((a, b) => a.date.localeCompare(b.date));
  const labels = sorted.map((r) => fmtDate(r.date));

  registerChart(
    "pacehr",
    new Chart(document.getElementById("pacehr"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Ritmo (min/km)",
            data: sorted.map((r) => r.pace_s / 60),
            yAxisID: "y",
            borderColor: "#4dd0a6",
            backgroundColor: "#4dd0a622",
            borderWidth: 2,
            pointRadius: 2.5,
            tension: 0.3,
            fill: true,
          },
          {
            label: "FC media (ppm)",
            data: sorted.map((r) => r.hr),
            yAxisID: "y2",
            borderColor: "#5b9cf6",
            borderWidth: 2,
            pointRadius: 2.5,
            tension: 0.3,
          },
        ],
      },
      options: {
        plugins: {
          legend: { display: true },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                if (ctx.dataset.yAxisID === "y") {
                  return "Ritmo: " + paceFmt(ctx.parsed.y * 60) + "/km";
                }
                return "FC: " + ctx.parsed.y + " ppm";
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            reverse: true,
            grid: { color: GRID },
            title: { display: true, text: "min/km (↑ = más rápido)" },
            ticks: { callback: (v) => paceFmt(v * 60) },
          },
          y2: {
            position: "right",
            grid: { display: false },
            title: { display: true, text: "FC ppm" },
            min: 125,
            max: 160,
          },
        },
      },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART 3: FC máxima por carrera + techo Z2 dashed line at 142
// ─────────────────────────────────────────────────────────────────────────────
function renderMaxHr(fRuns) {
  destroyChart("maxhr");
  if (!fRuns.length) return;

  const sorted = [...fRuns].sort((a, b) => a.date.localeCompare(b.date));
  const labels = sorted.map((r) => fmtDate(r.date));

  registerChart(
    "maxhr",
    new Chart(document.getElementById("maxhr"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "FC máx",
            data: sorted.map((r) => r.hr_max),
            borderColor: "#f6a35b",
            backgroundColor: "#f6a35b22",
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.3,
            fill: true,
          },
          {
            label: "Techo Z2 (142)",
            data: sorted.map(() => 142),
            borderColor: "#ef6b6b88",
            borderWidth: 1.5,
            borderDash: [6, 4],
            pointRadius: 0,
          },
        ],
      },
      options: {
        plugins: { legend: { display: true } },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: GRID }, min: 130, max: 185 },
        },
      },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART 4: Volumen mensual — ALWAYS full data (not range-filtered)
// ─────────────────────────────────────────────────────────────────────────────
function renderMonthly() {
  destroyChart("monthly");
  if (!runs.length) return;

  // Group by calendar month
  const monthMap = {};
  for (const r of runs) {
    const key = ym(r.date);
    if (!monthMap[key]) monthMap[key] = { km: 0, count: 0 };
    monthMap[key].km += r.km;
    monthMap[key].count += 1;
  }

  const keys = Object.keys(monthMap).sort();
  const MONTH_ES = [
    "Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
  ];
  const labels = keys.map((k) => {
    const [, m] = k.split("-");
    return MONTH_ES[parseInt(m, 10) - 1];
  });

  registerChart(
    "monthly",
    new Chart(document.getElementById("monthly"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "km",
            data: keys.map((k) => +monthMap[k].km.toFixed(1)),
            backgroundColor: "#4dd0a644",
            borderColor: "#4dd0a6",
            borderWidth: 1.5,
            borderRadius: 6,
          },
          {
            label: "carreras",
            data: keys.map((k) => monthMap[k].count),
            type: "line",
            yAxisID: "y2",
            borderColor: "#e8edf4",
            borderWidth: 2,
            pointRadius: 4,
          },
        ],
      },
      options: {
        plugins: { legend: { display: true } },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { color: GRID },
            title: { display: true, text: "km" },
          },
          y2: {
            position: "right",
            grid: { display: false },
            min: 0,
            max: 15,
            title: { display: true, text: "nº carreras" },
          },
        },
      },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART 5: EF — STUB (Task 8)
// ─────────────────────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
function renderEF() {
  // Task 8
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART 6: Sueño nocturno (score bars + sleep_hours line + rem_pct)
// ─────────────────────────────────────────────────────────────────────────────
function renderSleep(fDaily) {
  destroyChart("sleep");

  const data = fDaily
    .filter((d) => d.sleep_score != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!data.length) return;

  const labels = data.map((d) => fmtDate(d.date));

  // Bar color by score
  const barColors = data.map((d) => {
    if (d.sleep_score < 50) return "#ef6b6b";
    if (d.sleep_score < 70) return "#f6a35b";
    return "#4dd0a6";
  });

  // Party nights get distinct border
  const borderColors = data.map((d) =>
    d.party ? "#b86bef" : "transparent"
  );
  const borderWidths = data.map((d) => (d.party ? 2 : 0));

  registerChart(
    "sleep",
    new Chart(document.getElementById("sleep"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Score sueño",
            data: data.map((d) => d.sleep_score),
            backgroundColor: barColors,
            borderColor: borderColors,
            borderWidth: borderWidths,
            yAxisID: "y",
          },
          {
            label: "Horas sueño",
            data: data.map((d) => d.sleep_hours),
            type: "line",
            yAxisID: "y2",
            borderColor: "#5b9cf6",
            borderWidth: 2,
            pointRadius: 1.5,
            tension: 0.3,
          },
          {
            label: "REM %",
            data: data.map((d) => d.rem_pct),
            type: "line",
            yAxisID: "y3",
            borderColor: "#b86bef55",
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.3,
          },
        ],
      },
      options: {
        plugins: {
          legend: { display: true },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const d = data[ctx.dataIndex];
                const suffix = d.party ? " 🍺 fiesta" : "";
                return ctx.dataset.label + ": " + ctx.parsed.y + suffix;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { color: GRID },
            title: { display: true, text: "Score" },
            min: 0,
            max: 100,
          },
          y2: {
            position: "right",
            grid: { display: false },
            title: { display: true, text: "Horas" },
            min: 0,
            max: 12,
          },
          y3: {
            display: false,
            grid: { display: false },
            min: 0,
            max: 40,
          },
        },
      },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART 7: HRV + baseline band
// Band drawn via a custom plugin that fills a rect between balancedLow / balancedUpper.
// ─────────────────────────────────────────────────────────────────────────────
function renderHrv(fDaily) {
  destroyChart("hrv");

  const data = fDaily
    .filter((d) => d.hrv != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!data.length) return;

  const labels = data.map((d) => fmtDate(d.date));
  const low = status.hrv_baseline?.balancedLow ?? 45;
  const upper = status.hrv_baseline?.balancedUpper ?? 83;

  // Custom plugin: draws a translucent band between low and upper
  const bandPlugin = {
    id: "hrvBand",
    beforeDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea) return;
      const yScale = scales.y;
      const yTop = yScale.getPixelForValue(upper);
      const yBot = yScale.getPixelForValue(low);
      ctx.save();
      ctx.fillStyle = "rgba(91, 156, 246, 0.10)";
      ctx.fillRect(chartArea.left, yTop, chartArea.width, yBot - yTop);
      // border lines
      ctx.strokeStyle = "rgba(91, 156, 246, 0.30)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(chartArea.left, yTop);
      ctx.lineTo(chartArea.right, yTop);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(chartArea.left, yBot);
      ctx.lineTo(chartArea.right, yBot);
      ctx.stroke();
      ctx.restore();
    },
  };

  registerChart(
    "hrv",
    new Chart(document.getElementById("hrv"), {
      type: "line",
      plugins: [bandPlugin],
      data: {
        labels,
        datasets: [
          {
            label: "HRV (ms)",
            data: data.map((d) => d.hrv),
            borderColor: "#4dd0a6",
            backgroundColor: "#4dd0a618",
            borderWidth: 2,
            pointRadius: 2.5,
            tension: 0.35,
            fill: true,
          },
        ],
      },
      options: {
        plugins: {
          legend: { display: true },
          tooltip: { mode: "index", intersect: false },
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: GRID }, title: { display: true, text: "ms" } },
        },
      },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART 8: Body Battery (charged/drained paired bars)
// ─────────────────────────────────────────────────────────────────────────────
function renderBB(fDaily) {
  destroyChart("bb");

  const data = fDaily
    .filter((d) => d.bb_charged != null || d.bb_drained != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!data.length) return;

  const labels = data.map((d) => fmtDate(d.date));

  registerChart(
    "bb",
    new Chart(document.getElementById("bb"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Cargado",
            data: data.map((d) => d.bb_charged),
            backgroundColor: "#4dd0a655",
            borderColor: "#4dd0a6",
            borderWidth: 1,
            borderRadius: 3,
          },
          {
            label: "Drenado",
            data: data.map((d) => d.bb_drained),
            backgroundColor: "#ef6b6b44",
            borderColor: "#ef6b6b",
            borderWidth: 1,
            borderRadius: 3,
          },
        ],
      },
      options: {
        plugins: { legend: { display: true } },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { color: GRID },
            title: { display: true, text: "Battery points" },
          },
        },
      },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART 9: Carga de entrenamiento
// status.json is a current snapshot — no history.
// Render 2 bars (Aguda / Crónica) + band plugin for optimal range.
// ─────────────────────────────────────────────────────────────────────────────
function renderLoad() {
  destroyChart("load");

  const acute = status.acute_load ?? 0;
  const chronic = status.chronic_load ?? 0;
  const optMin = status.optimal_min ?? 0;
  const optMax = status.optimal_max ?? 0;

  const bandPlugin = {
    id: "loadBand",
    beforeDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea) return;
      const yScale = scales.y;
      const yTop = yScale.getPixelForValue(optMax);
      const yBot = yScale.getPixelForValue(optMin);
      ctx.save();
      ctx.fillStyle = "rgba(77, 208, 166, 0.10)";
      ctx.fillRect(chartArea.left, yTop, chartArea.width, yBot - yTop);
      ctx.strokeStyle = "rgba(77, 208, 166, 0.30)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(chartArea.left, yTop);
      ctx.lineTo(chartArea.right, yTop);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(chartArea.left, yBot);
      ctx.lineTo(chartArea.right, yBot);
      ctx.stroke();
      ctx.restore();
    },
  };

  registerChart(
    "load",
    new Chart(document.getElementById("load"), {
      type: "bar",
      plugins: [bandPlugin],
      data: {
        labels: ["Aguda (7d)", "Crónica (28d)"],
        datasets: [
          {
            label: "Carga",
            data: [acute, chronic],
            backgroundColor: ["#f6a35b88", "#5b9cf688"],
            borderColor: ["#f6a35b", "#5b9cf6"],
            borderWidth: 1.5,
            borderRadius: 6,
          },
        ],
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              afterLabel: () => `Rango óptimo: ${optMin.toFixed(0)}–${optMax.toFixed(0)}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { color: GRID },
            title: { display: true, text: "Carga (snapshot actual)" },
            min: 0,
          },
        },
      },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART 10: Cadencia + target band 160–165
// ─────────────────────────────────────────────────────────────────────────────
function renderCadence(fRuns) {
  destroyChart("cadence");
  if (!fRuns.length) return;

  const sorted = [...fRuns].sort((a, b) => a.date.localeCompare(b.date));
  const labels = sorted.map((r) => fmtDate(r.date));

  const bandPlugin = {
    id: "cadenceBand",
    beforeDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea) return;
      const yScale = scales.y;
      const yTop = yScale.getPixelForValue(165);
      const yBot = yScale.getPixelForValue(160);
      ctx.save();
      ctx.fillStyle = "rgba(246, 163, 91, 0.12)";
      ctx.fillRect(chartArea.left, yTop, chartArea.width, yBot - yTop);
      ctx.strokeStyle = "rgba(246, 163, 91, 0.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(chartArea.left, yTop);
      ctx.lineTo(chartArea.right, yTop);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(chartArea.left, yBot);
      ctx.lineTo(chartArea.right, yBot);
      ctx.stroke();
      ctx.restore();
    },
  };

  registerChart(
    "cadence",
    new Chart(document.getElementById("cadence"), {
      type: "line",
      plugins: [bandPlugin],
      data: {
        labels,
        datasets: [
          {
            label: "Cadencia (spm)",
            data: sorted.map((r) => r.cadence),
            borderColor: "#f6a35b",
            backgroundColor: "#f6a35b22",
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.3,
            fill: false,
          },
        ],
      },
      options: {
        plugins: {
          legend: { display: true },
          tooltip: {
            callbacks: {
              label: (ctx) => `Cadencia: ${ctx.parsed.y} spm`,
            },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { color: GRID },
            title: { display: true, text: "spm" },
          },
        },
      },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART 11: Peso corporal
// Hide weightCard if fewer than 2 data points.
// ─────────────────────────────────────────────────────────────────────────────
function renderWeight(fDaily) {
  destroyChart("weight");

  const data = fDaily
    .filter((d) => d.weight_kg != null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (data.length < 2) {
    const wCard = document.getElementById("weightCard");
    if (wCard) wCard.style.display = "none";
    return;
  }

  const labels = data.map((d) => fmtDate(d.date));

  registerChart(
    "weight",
    new Chart(document.getElementById("weight"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Peso (kg)",
            data: data.map((d) => d.weight_kg),
            borderColor: "#5b9cf6",
            backgroundColor: "#5b9cf622",
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.3,
            fill: true,
          },
        ],
      },
      options: {
        plugins: { legend: { display: true } },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { color: GRID },
            title: { display: true, text: "kg" },
          },
        },
      },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RUNS TABLE — last 10 filtered runs, newest first
// ─────────────────────────────────────────────────────────────────────────────
function renderRunsTable(fRuns) {
  const tbody = document.querySelector("#runsTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const sorted = [...fRuns]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);

  for (const r of sorted) {
    const tr = document.createElement("tr");
    tr.dataset.id = r.id;
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => openRunModal(r.id));

    const cells = [
      fmtDate(r.date),
      r.km.toFixed(2),
      fmtDur(r.dur_s),
      paceFmt(r.pace_s) + "/km",
      r.hr != null ? Math.round(r.hr) : "—",
      r.hr_max != null ? Math.round(r.hr_max) : "—",
      r.cadence != null ? r.cadence : "—",
      r.ef != null ? r.ef.toFixed(2) : "—",
      r.temp_c != null ? r.temp_c + "°" : "—",
    ];

    for (const cell of cells) {
      const td = document.createElement("td");
      td.textContent = cell;
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 8 STUBS — empty, clearly marked
// ─────────────────────────────────────────────────────────────────────────────

// Task 8: drill-down modal for individual run
// eslint-disable-next-line no-unused-vars
function openRunModal(id) {
  // Task 8
}

// Task 8: correlation scatter chart
function renderScatter() {
  // Task 8
}

// Task 8: activity heatmap calendar
function renderHeatmap() {
  // Task 8
}

// Task 8: today panel / semáforo recommendation
function renderToday() {
  // Task 8
}

// ─────────────────────────────────────────────────────────────────────────────
// Kick off
// ─────────────────────────────────────────────────────────────────────────────
init();
