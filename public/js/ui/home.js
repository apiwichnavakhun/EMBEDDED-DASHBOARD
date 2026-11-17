// หน้าหลัก: ปริมาณ % เป็นพระเอก + น้ำหนัก / ประเภทขยะ / สถานะอุปกรณ์
import { STATUS_META, DEVICE_META, CFG } from '../data/status.js';
import { ago, dayLabel, fmtTime, fmtDateTime, fmtKg, dur, esc } from './format.js';
import { sparkline } from './charts.js';
import { openSheet, updateSheet, isSheetOpen } from './sheet.js';

const DEVICES = {
  camera: { name: 'กล้อง', icon: 'cam' },
  servo: { name: 'Servo', icon: 'servo' },
};

const FIX_HINT = {
  camera: {
    error: 'ลองรีสตาร์ตบอร์ด ESP32-CAM และตรวจสายแพกล้องว่าเสียบแน่น',
    warn: 'ตรวจว่ามีแสงพอและเลนส์ไม่สกปรก',
    unresponsive: 'กล้องไม่ส่ง heartbeat ตรวจไฟเลี้ยงและ WiFi ของกล้อง',
  },
  servo: {
    error: 'ตรวจว่ามีขยะขวางฝาช่องแยกหรือไม่ แล้วสั่งรีเซ็ต servo',
    warn: 'servo ตอบสนองช้า ตรวจแรงดันไฟเลี้ยง (5–6V)',
    unresponsive: 'ไม่ได้รับสถานะจาก servo ตรวจสายสัญญาณและไฟเลี้ยง',
  },
};

function forecastText(fc, status) {
  if (status === 'offline' || !fc) return 'พยากรณ์ไม่ได้ระหว่างออฟไลน์';
  if (fc.reached) return `ถึงเกณฑ์เต็ม (${CFG.full}%) แล้ว`;
  if (fc.beyond) return 'คาดว่ายังไม่เต็มภายใน 3 วัน';
  return `คาดว่าจะเต็ม (${CFG.full}%) ประมาณ <b>${dayLabel(fc.t)} ${fmtTime(fc.t)} น.</b>`;
}

function deviceRow(key, d) {
  const meta = DEVICES[key];
  const msg = d.state === 'ok' ? 'ทำงานปกติ'
    : d.state === 'unresponsive' ? `เงียบไป ${ago(Date.now() - d.last_seen).replace('ที่แล้ว', '')}`
    : (d.error || d.warning || DEVICE_META[d.state].label);
  return `
    <button class="dev-row" data-device="${key}" aria-label="${meta.name}: ${DEVICE_META[d.state].label} แตะเพื่อดูรายละเอียด">
      <span class="dot dev-${d.state}" aria-hidden="true"></span>
      <span class="dev-name">${meta.name}</span>
      <span class="dev-msg">${esc(msg)}</span>
      <span class="dev-state dev-${d.state}-text">${DEVICE_META[d.state].label}</span>
      <span class="chev" aria-hidden="true">›</span>
    </button>`;
}

function deviceSheet(key, d, incidents) {
  const meta = DEVICES[key];
  const now = Date.now();
  const rows = [
    ['สถานะ', `<span class="dot dev-${d.state}"></span> ${DEVICE_META[d.state].label}`],
    ['ตอบกลับล่าสุด', d.last_seen ? `${ago(now - d.last_seen)} <small>(${fmtTime(d.last_seen)} น.)</small>` : '—'],
  ];
  if (d.last_ok && d.state !== 'ok') rows.push(['ปกติครั้งล่าสุด', `${fmtDateTime(d.last_ok)} น.`]);
  rows.push(['Error ล่าสุด', d.error ? `<span class="err">${esc(d.error)}</span>` : (d.warning ? esc(d.warning) : 'ไม่มี')]);
  if (d.info?.model) rows.push(['รุ่น', esc(d.info.model)]);
  if (key === 'camera' && d.info?.last_result) rows.push(['ผลจำแนกล่าสุด', esc(d.info.last_result)]);
  if (key === 'servo' && d.info?.last_action) rows.push(['สั่งงานล่าสุด', esc(d.info.last_action)]);
  if (key === 'servo' && d.info?.cycles_today != null) rows.push(['เปิด-ปิดวันนี้', `${d.info.cycles_today} ครั้ง`]);

  const list = (incidents || []).filter((x) => x.device === key);
  return `
    <h2 id="sheet-title" class="sheet-title"><span class="dev-ico ico-${meta.icon}" aria-hidden="true"></span>${meta.name}</h2>
    <dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    ${d.state !== 'ok' ? `<p class="hint"><b>วิธีแก้เบื้องต้น:</b> ${FIX_HINT[key][d.state]}</p>` : ''}
    <h3 class="sub-h">ประวัติปัญหา 30 วัน</h3>
    ${list.length ? `<ul class="inc-list">${list.map((x) => `
      <li><span class="dot dev-${x.state}"></span>
        <div><b>${DEVICE_META[x.state].label}</b> · ${esc(x.message)}
        <small>${fmtDateTime(x.t_start)} · ${x.t_end ? `นาน ${dur(x.t_end - x.t_start)}` : '<b class="err">ยังไม่หาย</b>'}</small></div></li>`).join('')}</ul>`
      : '<p class="muted">ไม่มีปัญหาใน 30 วัน</p>'}`;
}

export function mountHome(el, repo, { onOpenHistory, onScenarioChange }) {
  let vm = null;
  let wasteMode = 'pct'; // 'pct' | 'count'
  let openDevice = null;
  let loading = false;
  let error = null;

  function render() {
    if (!vm) {
      el.innerHTML = `<div class="skeleton-wrap"><div class="skel skel-hero"></div><div class="skel skel-chip"></div><div class="skel skel-chip"></div></div>`;
      return;
    }
    const st = vm.status;
    const meta = STATUS_META[st];
    const fill = Math.max(0, Math.min(100, vm.fill));
    const w = vm.waste;
    const pctR = w.pctRecycle, pctN = w.total ? 100 - pctR : 0;
    const showR = wasteMode === 'pct' ? `${pctR}%` : `${w.recycle} ชิ้น`;
    const showN = wasteMode === 'pct' ? `${pctN}%` : `${w.non_recycle} ชิ้น`;
    const wd = vm.weight.delta1h;

    el.innerHTML = `
      <header class="topbar">
        <div class="tb-text">
          <div class="tb-row"><h1 class="tb-title">${esc(vm.name)}</h1>${repo.isMock ? '<span class="tag">ข้อมูลตัวอย่าง</span>' : ''}</div>
          <p class="tb-sub"><span class="dot ${vm.online ? 'dev-ok' : 'dev-unresponsive'}" aria-hidden="true"></span>${vm.online ? 'ออนไลน์' : 'ออฟไลน์'} · <span data-ago>อัปเดต ${ago(Date.now() - vm.lastSeen)}</span></p>
        </div>
        <button class="icon-btn ${loading ? 'spin' : ''}" data-refresh aria-label="รีเฟรชข้อมูล" title="รีเฟรช">↻</button>
      </header>

      ${error ? `<div class="banner" role="alert">โหลดข้อมูลไม่สำเร็จ แสดงค่าล่าสุดที่มี · ${esc(error)}</div>` : ''}

      ${repo.isMock ? `
      <nav class="scenarios" aria-label="ดูตัวอย่างสถานะ">
        <span class="sc-label">ดูตัวอย่างสถานะ (ต้นแบบ)</span>
        <div class="sc-row">${repo.scenarios.map((s) => `<button class="chip" data-scenario="${s.id}" aria-pressed="${repo.getScenario() === s.id}">${s.label}</button>`).join('')}</div>
      </nav>` : ''}

      <section class="card hero st-${st}" aria-label="ปริมาณขยะในถัง">
        <div class="hero-top">
          <img class="mascot" src="img/bin_${meta.mascot}_512.png" width="128" height="128" alt="น้องถังขยะ หน้า${meta.label}">
          <div class="hero-num">
            <div class="pct"><span class="pct-n">${Math.round(fill)}</span><span class="pct-u">%</span></div>
            <span class="badge st-${st}">${meta.label}</span>
            ${st === 'offline' ? `<small class="muted">ค่าล่าสุดเมื่อ ${fmtTime(vm.lastSeen)} น.</small>` : ''}
          </div>
        </div>
        <div class="gauge" role="meter" aria-label="ปริมาณขยะ" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(fill)}">
          <div class="gauge-fill" style="width:${fill}%"></div>
          <i class="gauge-tick" style="left:${CFG.near}%"></i><i class="gauge-tick" style="left:${CFG.full}%"></i>
        </div>
        <div class="gauge-scale" aria-hidden="true"><span style="left:0">0</span><span style="left:${CFG.near}%">${CFG.near}</span><span style="left:${CFG.full}%">${CFG.full}</span><span style="left:100%">%</span></div>
        <p class="advice">${meta.advice}</p>
        <p class="forecast"><span class="ico-clock" aria-hidden="true"></span><span>${forecastText(vm.forecast, st)}</span></p>
      </section>

      <div class="minis">
        <section class="card mini" aria-label="น้ำหนัก">
          <h2 class="mini-h">น้ำหนักในถัง</h2>
          <div class="mini-val"><b>${fmtKg(vm.weight.g)}</b> กก.</div>
          <p class="mini-sub">${wd == null ? '—' : wd >= 50 ? `+${fmtKg(wd)} กก. ใน 1 ชม.` : wd <= -50 ? `${fmtKg(wd)} กก. ใน 1 ชม.` : 'คงที่ใน 1 ชม.'}</p>
          ${sparkline(vm.recent.map((p) => p.weight_g))}
        </section>

        <button class="card mini waste" data-waste aria-label="ประเภทขยะ รีไซเคิล ${pctR}% ${w.recycle} ชิ้น ไม่รีไซเคิล ${pctN}% ${w.non_recycle} ชิ้น แตะเพื่อสลับการแสดงผล">
          <h2 class="mini-h">ประเภทขยะ <small class="muted">แตะดู ${wasteMode === 'pct' ? 'ชิ้น' : '%'}</small></h2>
          <div class="split" aria-hidden="true">
            ${w.total ? `<i class="seg-r" style="flex:${w.recycle}"></i><i class="seg-n" style="flex:${w.non_recycle}"></i>` : '<i class="seg-empty"></i>'}
          </div>
          <div class="split-legend">
            <span><i class="sw sw-r"></i>รีไซเคิล <b>${showR}</b></span>
            <span><i class="sw sw-n"></i>ไม่รีไซเคิล <b>${showN}</b></span>
          </div>
          <p class="mini-sub">รวม ${w.total} ชิ้นตั้งแต่เทครั้งล่าสุด</p>
        </button>

        <section class="card mini devices" aria-label="สถานะอุปกรณ์">
          <h2 class="mini-h">สถานะอุปกรณ์</h2>
          ${deviceRow('camera', vm.devices.camera)}
          ${deviceRow('servo', vm.devices.servo)}
        </section>
      </div>

      <button class="btn btn-big" data-history>
        <span class="ico-chart" aria-hidden="true"></span>
        <span>ข้อมูลย้อนหลัง<small>กราฟ · ประวัติการเท · เหตุการณ์</small></span>
        <span class="chev" aria-hidden="true">▶</span>
      </button>
      <p class="foot muted">${repo.isMock ? 'ต้นแบบ: ตัวเลขทั้งหมดเป็นข้อมูลจำลอง' : 'อัปเดตอัตโนมัติทุก 30 วินาที'}</p>`;
  }

  async function showDevice(key) {
    openDevice = key;
    openSheet(deviceSheet(key, vm.devices[key], null), () => { openDevice = null; });
    try {
      const d = await repo.getDevices();
      if (openDevice === key) updateSheet(deviceSheet(key, d[key], d.incidents));
    } catch { /* แสดงแบบไม่มีประวัติ */ }
  }

  el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-refresh')) refresh();
    else if (t.hasAttribute('data-history')) onOpenHistory();
    else if (t.hasAttribute('data-waste')) { wasteMode = wasteMode === 'pct' ? 'count' : 'pct'; render(); el.querySelector('[data-waste]')?.focus(); }
    else if (t.dataset.device) showDevice(t.dataset.device);
    else if (t.dataset.scenario) { repo.setScenario(t.dataset.scenario); onScenarioChange?.(t.dataset.scenario); refresh(); }
  });

  async function refresh() {
    if (loading) return;
    loading = true;
    el.querySelector('[data-refresh]')?.classList.add('spin');
    try {
      vm = await repo.getHome();
      error = null;
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
      render();
      if (openDevice && vm && isSheetOpen()) {
        repo.getDevices().then((d) => openDevice && updateSheet(deviceSheet(openDevice, d[openDevice], d.incidents))).catch(() => {});
      }
    }
  }

  function tickClock() {
    const a = el.querySelector('[data-ago]');
    if (a && vm) a.textContent = `อัปเดต ${ago(Date.now() - vm.lastSeen)}`;
  }

  render();
  return { refresh, tickClock };
}
