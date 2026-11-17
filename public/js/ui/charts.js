// กราฟทั้งหมด (Chart.js 4 — โหลดจาก /vendor เป็น window.Chart)
import { fmtTime, fmtDate, fmtDateTime, fmtKg, esc } from './format.js';
import { EVENT_META, CFG } from '../data/status.js';

const H = 3600e3, DAY = 864e5, BKK = 7 * H;
export const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function alpha(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

let defaultsSet = false;
function setDefaults() {
  const Chart = window.Chart;
  Chart.defaults.font.family = "'Unifont', ui-monospace, monospace";
  Chart.defaults.font.size = 16;
  Chart.defaults.color = cssVar('--muted');
  if (defaultsSet) return;
  defaultsSet = true;
  Chart.register(thresholdPlugin, crosshairPlugin);
}

// เส้นเกณฑ์ 70% / 90% (เส้นประ + ป้ายชิดขวา)
const thresholdPlugin = {
  id: 'thresholds',
  beforeDatasetsDraw(chart, _a, opts) {
    if (!opts?.lines?.length) return;
    const { ctx, chartArea: a, scales: { y } } = chart;
    ctx.save();
    for (const l of opts.lines) {
      const py = Math.round(y.getPixelForValue(l.value)) + 0.5;
      ctx.strokeStyle = l.color; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "16px 'Unifont', monospace";
      const w = ctx.measureText(l.label).width + 8;
      ctx.fillStyle = cssVar('--card');
      ctx.fillRect(a.right - w, py - 17, w, 16);
      ctx.fillStyle = l.ink; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillText(l.label, a.right - 4, py - 1);
    }
    ctx.restore();
  },
};

// เส้นแนวตั้งตามจุดที่แตะ/ชี้
const crosshairPlugin = {
  id: 'crosshair',
  afterDatasetsDraw(chart) {
    const act = chart.tooltip?.getActiveElements?.();
    if (!act?.length || chart.config.type === 'bar') return;
    const x = Math.round(act[0].element.x) + 0.5;
    const { ctx, chartArea: a } = chart;
    ctx.save();
    ctx.strokeStyle = cssVar('--ink'); ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke();
    ctx.restore();
  },
};

function timeAxis(range, min, max) {
  const step = range === '24h' ? 6 * H : range === '7d' ? 2 * DAY : 7 * DAY;
  const dm = (v) => { const d = new Date(v + BKK); return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`; };
  return {
    type: 'linear', min, max,
    grid: { display: false },
    border: { color: cssVar('--ink'), width: 2 },
    afterBuildTicks(axis) {
      const ticks = [];
      // จัดให้ตรงเที่ยงคืน/ทุก 6 ชม. เวลาไทย (30 วัน: ทุกวันจันทร์)
      let t = Math.ceil((min + BKK) / step) * step - BKK;
      if (range === '7d') t = Math.ceil((min + BKK) / DAY) * DAY - BKK;
      if (range === '30d') {
        t = Math.ceil((min + BKK) / DAY) * DAY - BKK;
        while (new Date(t + BKK).getUTCDay() !== 1) t += DAY;
      }
      for (; t <= max; t += step) ticks.push({ value: t });
      axis.ticks = ticks;
    },
    ticks: {
      maxRotation: 0, autoSkip: false,
      callback: (v) => (range === '24h' ? fmtTime(v) : dm(v)),
    },
  };
}

function tooltipBase() {
  return {
    backgroundColor: cssVar('--ink'), titleColor: cssVar('--on-ink'), bodyColor: cssVar('--on-ink'),
    titleFont: { family: 'Unifont', size: 16, weight: 'normal' }, bodyFont: { family: 'Unifont', size: 16 },
    cornerRadius: 0, padding: 8, caretSize: 6, displayColors: false,
  };
}

const statusColor = (type) => cssVar(`--st-${EVENT_META[type]?.status || 'offline'}`);

/** กราฟระดับขยะ (%) + เส้นเกณฑ์ + จุดเหตุการณ์ */
export function fillChart(canvas, { points, events, range, now }) {
  setDefaults();
  const green = cssVar('--series-1');
  const min = now - (range === '30d' ? 30 : range === '7d' ? 7 : 1) * DAY;
  return new window.Chart(canvas, {
    data: {
      datasets: [
        {
          type: 'line', label: 'ระดับขยะ', data: points.map((p) => ({ x: p.t, y: p.fill })),
          borderColor: green, backgroundColor: alpha(green, 0.14), fill: 'origin',
          borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: green,
          pointHoverBorderColor: cssVar('--card'), pointHoverBorderWidth: 2, tension: 0, order: 2,
        },
        {
          type: 'scatter', label: 'เหตุการณ์', data: events.map((e) => ({ x: e.t, y: e.fill, type: e.type })),
          pointStyle: 'rectRot', pointRadius: 6, pointHoverRadius: 8,
          backgroundColor: (c) => statusColor(c.raw?.type), borderColor: cssVar('--card'), borderWidth: 2, order: 1,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales: {
        x: timeAxis(range, min, now),
        y: {
          min: 0, max: 100, border: { display: false },
          grid: { color: cssVar('--grid') },
          ticks: { stepSize: 25, callback: (v) => `${v}%` },
        },
      },
      plugins: {
        legend: { display: false },
        thresholds: {
          lines: [
            { value: CFG.near, color: cssVar('--st-near'), ink: cssVar('--text'), label: `${CFG.near}%` },
            { value: CFG.full, color: cssVar('--st-full'), ink: cssVar('--text'), label: `${CFG.full}%` },
          ],
        },
        tooltip: {
          ...tooltipBase(),
          callbacks: {
            title: (it) => fmtDateTime(it[0].parsed.x),
            label: (it) => (it.datasetIndex === 1
              ? `◆ ${EVENT_META[it.raw.type]?.label || it.raw.type} (${it.parsed.y}%)`
              : `ระดับ ${it.parsed.y.toFixed(1)}%${range !== '24h' ? ' (สูงสุดช่วงนั้น)' : ''}`),
          },
        },
      },
    },
  });
}

/** กราฟน้ำหนักในถัง (กก.) */
export function weightChart(canvas, { points, range, now }) {
  setDefaults();
  const c = cssVar('--series-1');
  const min = now - (range === '30d' ? 30 : range === '7d' ? 7 : 1) * DAY;
  const maxKg = Math.max(1, ...points.map((p) => p.weight_g / 1000));
  return new window.Chart(canvas, {
    type: 'line',
    data: { datasets: [{
      label: 'น้ำหนัก', data: points.map((p) => ({ x: p.t, y: p.weight_g / 1000 })),
      borderColor: c, backgroundColor: alpha(c, 0.12), fill: 'origin', borderWidth: 2,
      pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: c,
      pointHoverBorderColor: cssVar('--card'), pointHoverBorderWidth: 2, tension: 0,
    }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      scales: {
        x: timeAxis(range, min, now),
        y: { min: 0, suggestedMax: Math.ceil(maxKg), border: { display: false }, grid: { color: cssVar('--grid') },
          ticks: { maxTicksLimit: 5, callback: (v) => `${v} กก.` } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { ...tooltipBase(), callbacks: {
          title: (it) => fmtDateTime(it[0].parsed.x),
          label: (it) => `น้ำหนัก ${it.parsed.y.toFixed(1)} กก.`,
        } },
      },
    },
  });
}

/** แท่งซ้อน: จำนวนชิ้นรีไซเคิล / ไม่รีไซเคิล ต่อช่วงเวลา */
export function wasteChart(canvas, { buckets, range }) {
  setDefaults();
  const card = cssVar('--card');
  const label = (t) => (range === '24h' ? fmtTime(t) : fmtDate(t));
  const ds = (name, key, color, top) => ({
    label: name, data: buckets.map((b) => b[key]), backgroundColor: color,
    borderColor: card, borderWidth: { top: 2 }, borderSkipped: 'bottom',
    borderRadius: top ? { topLeft: 4, topRight: 4 } : 0, maxBarThickness: 28, categoryPercentage: 0.8,
  });
  return new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels: buckets.map((b) => label(b.t)),
      datasets: [
        ds('รีไซเคิล', 'recycle', cssVar('--series-1'), false),
        ds('ไม่รีไซเคิล', 'non_recycle', cssVar('--series-2'), true),
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { stacked: true, grid: { display: false }, border: { color: cssVar('--ink'), width: 2 },
          ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: range === '30d' ? 5 : 6 } },
        y: { stacked: true, border: { display: false }, grid: { color: cssVar('--grid') },
          ticks: { maxTicksLimit: 5, precision: 0 } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { ...tooltipBase(), displayColors: true, boxPadding: 4, callbacks: {
          title: (it) => (range === '24h' ? `${fmtDate(buckets[it[0].dataIndex].t)} ${it[0].label}` : it[0].label),
          label: (it) => `${it.dataset.label} ${it.parsed.y} ชิ้น`,
          footer: (it) => {
            const b = buckets[it[0].dataIndex];
            const tot = b.recycle + b.non_recycle;
            return tot ? `รวม ${tot} ชิ้น · รีไซเคิล ${Math.round((b.recycle / tot) * 100)}%` : 'ไม่มีขยะเข้า';
          },
        } },
      },
    },
  });
}

/** sparkline เล็ก (SVG) สำหรับการ์ดน้ำหนัก */
export function sparkline(values, w = 120, h = 32) {
  if (values.length < 2) return '';
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 3 - ((v - min) / span) * (h - 6)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

export { esc, fmtKg };
