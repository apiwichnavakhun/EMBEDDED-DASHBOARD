// หน้าข้อมูลย้อนหลัง: กราฟระดับ / สถิติ / ประวัติการเท / เหตุการณ์ / น้ำหนัก / ประเภทขยะ / อุปกรณ์
import { EVENT_META, DEVICE_META } from '../data/status.js';
import { fmtTime, fmtDate, fmtDateTime, fmtKg, dur, ago, pad2, esc } from './format.js';
import { fillChart, weightChart, wasteChart } from './charts.js';

const RANGES = [
  { id: '24h', label: '24 ชม.' },
  { id: '7d', label: '7 วัน' },
  { id: '30d', label: '30 วัน' },
];
const DEV_NAME = { camera: 'กล้อง', servo: 'Servo' };

export function mountHistory(el, repo, { onBack }) {
  let range = '24h';
  let vm = null;
  let charts = [];
  let showAllPickups = false;
  let loading = false;
  let error = null;
  let seq = 0;

  function destroyCharts() { charts.forEach((c) => c.destroy()); charts = []; }

  function shell() {
    el.innerHTML = `
      <header class="topbar">
        <button class="icon-btn back" data-back aria-label="กลับหน้าหลัก">◀</button>
        <div class="tb-text">
          <div class="tb-row"><h1 class="tb-title">ข้อมูลย้อนหลัง</h1>${repo.isMock ? '<span class="tag">ข้อมูลตัวอย่าง</span>' : ''}</div>
          <p class="tb-sub">ถังขยะ CEDT ชั้น 1</p>
        </div>
      </header>
      <div class="seg" role="tablist" aria-label="ช่วงเวลา">
        ${RANGES.map((r) => `<button role="tab" data-range="${r.id}" aria-selected="${r.id === range}">${r.label}</button>`).join('')}
      </div>
      <div data-body></div>`;
  }

  function statTile(label, value, sub) {
    return `<div class="stat"><span class="stat-l">${label}</span><b class="stat-v">${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  }

  function body() {
    const b = el.querySelector('[data-body]');
    if (!vm) {
      b.innerHTML = error
        ? `<div class="banner" role="alert">โหลดข้อมูลไม่สำเร็จ · ${esc(error)} <button class="btn" data-retry>ลองใหม่</button></div>`
        : `<div class="skeleton-wrap"><div class="skel skel-chart"></div><div class="skel skel-chip"></div><div class="skel skel-chip"></div></div>`;
      return;
    }
    const { stats, pickups, allEvents, waste, devices, points } = vm;
    const now = Date.now();
    const pk = showAllPickups ? pickups : pickups.slice(0, 6);
    const totW = waste.recycle + waste.non_recycle;
    const pctR = totW ? Math.round((waste.recycle / totW) * 100) : 0;
    const rangeLabel = RANGES.find((r) => r.id === range).label;
    const usedEvents = [...new Set(vm.events.map((e) => e.type))];

    b.innerHTML = `
      <section class="card">
        <h2 class="card-h">ระดับขยะ (%) · ${rangeLabel}</h2>
        <div class="legend" aria-label="คำอธิบายกราฟ">
          <span><i class="lg-line"></i>ระดับขยะ</span>
          <span><i class="lg-dash near"></i>ใกล้เต็ม 70%</span>
          <span><i class="lg-dash full"></i>เต็ม 90%</span>
          ${usedEvents.map((t) => `<span><i class="lg-dia st-bg-${EVENT_META[t].status}"></i>${EVENT_META[t].label}</span>`).join('')}
        </div>
        <div class="chart-box tall"><canvas data-chart="fill" role="img" aria-label="กราฟระดับขยะย้อนหลัง ${rangeLabel}"></canvas></div>
        <p class="muted chart-tip">แตะหรือลากนิ้วบนกราฟเพื่อดูค่า</p>
        <details class="table-view">
          <summary>ดูเป็นตาราง</summary>
          <div class="tbl-scroll"><table>
            <thead><tr><th>เวลา</th><th>ระดับ</th><th>น้ำหนัก</th></tr></thead>
            <tbody>${[...points].reverse().map((p) => `<tr><td>${fmtDateTime(p.t)}</td><td>${p.fill.toFixed(1)}%</td><td>${fmtKg(p.weight_g)} กก.</td></tr>`).join('')}</tbody>
          </table></div>
        </details>
      </section>

      <section class="stats" aria-label="สถิติสรุป 30 วัน">
        ${statTile('เทล่าสุด', stats.lastPickup ? ago(now - stats.lastPickup.t) : '—', stats.lastPickup ? `${fmtDateTime(stats.lastPickup.t)} น.` : '')}
        ${statTile('รอบการเทเฉลี่ย', stats.avgInterval ? dur(stats.avgInterval) : '—', stats.avgBefore ? `เทตอนเฉลี่ย ${stats.avgBefore}%` : '')}
        ${statTile('เทใน 30 วัน', `${stats.count30} ครั้ง`, `${(stats.count30 / 30 * 7).toFixed(1)} ครั้ง/สัปดาห์`)}
        ${statTile('ขยะเพิ่มเร็วสุด', stats.peak ? `${pad2(stats.peak.from)}:00–${pad2(stats.peak.to)}:00` : '—', stats.peak ? `~${stats.peak.rate.toFixed(1)}% ต่อชม.` : '')}
      </section>

      <section class="card">
        <h2 class="card-h">ประวัติการเทขยะ <small class="muted">30 วัน</small></h2>
        ${pk.length ? `<ul class="rows">${pk.map((p) => `
          <li class="row">
            <span class="dot st-dot-emptied" aria-hidden="true"></span>
            <div class="row-main"><b>${fmtDate(p.t)} · ${fmtTime(p.t)} น.</b>
              <small>${p.gap ? `ห่างจากครั้งก่อน ${dur(p.gap)}` : 'ครั้งแรกในช่วงนี้'}${p.weight_before_g ? ` · ${fmtKg(p.weight_before_g)} กก.` : ''}</small></div>
            <span class="pill ${p.before >= 90 ? 'st-full' : p.before >= 70 ? 'st-near' : 'st-ok'}">ก่อนเท ${Math.round(p.before)}%</span>
          </li>`).join('')}</ul>
          ${pickups.length > 6 ? `<button class="btn btn-block" data-more>${showAllPickups ? 'ย่อรายการ' : `ดูทั้งหมด (${pickups.length})`}</button>` : ''}`
          : '<p class="muted">ยังไม่มีการเทใน 30 วัน</p>'}
      </section>

      <section class="card">
        <h2 class="card-h">เหตุการณ์ล่าสุด <small class="muted">ที่แจ้งเตือนไป LINE</small></h2>
        ${allEvents.length ? `<ul class="rows">${allEvents.slice(0, 10).map((e) => `
          <li class="row">
            <span class="dia st-bg-${EVENT_META[e.type]?.status}" aria-hidden="true"></span>
            <div class="row-main"><b>${EVENT_META[e.type]?.label || esc(e.type)} <span class="muted">(${Math.round(e.fill)}%)</span></b>
              <small>${fmtDateTime(e.t)} น. · ${ago(now - e.t)}</small></div>
            <span class="pill ${e.notified ? 'pill-line' : 'pill-muted'}">${e.notified ? 'ส่ง LINE แล้ว' : 'ไม่ได้ส่ง'}</span>
          </li>`).join('')}</ul>` : '<p class="muted">ยังไม่มีเหตุการณ์</p>'}
      </section>

      <section class="card">
        <h2 class="card-h">น้ำหนักในถัง (กก.) · ${rangeLabel}</h2>
        <div class="chart-box"><canvas data-chart="weight" role="img" aria-label="กราฟน้ำหนักย้อนหลัง"></canvas></div>
      </section>

      <section class="card">
        <h2 class="card-h">รีไซเคิล / ไม่รีไซเคิล · ${rangeLabel}</h2>
        <div class="legend">
          <span><i class="sw sw-r"></i>รีไซเคิล <b>${waste.recycle}</b> ชิ้น (${pctR}%)</span>
          <span><i class="sw sw-n"></i>ไม่รีไซเคิล <b>${waste.non_recycle}</b> ชิ้น (${totW ? 100 - pctR : 0}%)</span>
        </div>
        <div class="chart-box"><canvas data-chart="waste" role="img" aria-label="กราฟจำนวนขยะแยกประเภท"></canvas></div>
        <p class="muted chart-tip">${range === '24h' ? 'แต่ละแท่ง = 2 ชั่วโมง' : 'แต่ละแท่ง = 1 วัน'}</p>
      </section>

      <section class="card">
        <h2 class="card-h">ประวัติสถานะกล้อง / Servo <small class="muted">30 วัน</small></h2>
        <div class="dev-now">
          ${['camera', 'servo'].map((k) => `<span><i class="dot dev-${devices[k].state}"></i>${DEV_NAME[k]}: ${DEVICE_META[devices[k].state].label}</span>`).join('')}
        </div>
        ${devices.incidents.length ? `<ul class="rows">${devices.incidents.map((x) => `
          <li class="row">
            <span class="dot dev-${x.state}" aria-hidden="true"></span>
            <div class="row-main"><b>${DEV_NAME[x.device]} · ${DEVICE_META[x.state].label}</b>
              <small>${esc(x.message)}<br>${fmtDateTime(x.t_start)} น. · ${x.t_end ? `นาน ${dur(x.t_end - x.t_start)}` : '<b class="err">ยังไม่หาย</b>'}</small></div>
          </li>`).join('')}</ul>` : '<p class="muted">ไม่มีปัญหาใน 30 วัน</p>'}
      </section>`;

    destroyCharts();
    const ctx = { points, events: vm.events, range, now };
    charts.push(fillChart(b.querySelector('[data-chart="fill"]'), ctx));
    charts.push(weightChart(b.querySelector('[data-chart="weight"]'), ctx));
    charts.push(wasteChart(b.querySelector('[data-chart="waste"]'), { buckets: waste.buckets, range }));
  }

  async function load({ quiet = false } = {}) {
    const my = ++seq;
    loading = true;
    if (!quiet) { vm = null; error = null; destroyCharts(); body(); }
    try {
      const data = await repo.getHistory(range);
      if (my !== seq) return;
      vm = data; error = null;
    } catch (err) {
      if (my !== seq) return;
      error = err.message;
    } finally {
      if (my === seq) { loading = false; body(); }
    }
  }

  el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-back')) onBack();
    else if (t.hasAttribute('data-retry')) load();
    else if (t.hasAttribute('data-more')) { showAllPickups = !showAllPickups; body(); }
    else if (t.dataset.range && t.dataset.range !== range) {
      range = t.dataset.range;
      el.querySelectorAll('[data-range]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.range === range)));
      load();
    }
  });

  // ลูกศรซ้าย/ขวาเลื่อนแท็บช่วงเวลา
  el.addEventListener('keydown', (e) => {
    const t = e.target.closest('[data-range]');
    if (!t || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const i = RANGES.findIndex((r) => r.id === range) + (e.key === 'ArrowRight' ? 1 : -1);
    const next = el.querySelector(`[data-range="${RANGES[(i + RANGES.length) % RANGES.length].id}"]`);
    next.focus(); next.click();
  });

  shell();
  return {
    open() { load(); },
    refresh() { if (!loading) load({ quiet: true }); },
    rerender() { if (vm) body(); },
    close() { destroyCharts(); },
  };
}
