// แหล่งข้อมูลจำลอง — คืนค่ารูปแบบเดียวกับ API จริง (ดู README "Data contract")
// เวลาเป็น milliseconds ทั้งหมด
import { replay } from './status.js';

const STEP = 10 * 60e3;
const DAY = 864e5;
const BKK = 7 * 3600e3;

// อัตราเพิ่มของขยะ (% ต่อ 10 นาที) ตามชั่วโมงของวัน (เวลาไทย)
const HOURLY = [0.02, 0.01, 0.01, 0.01, 0.02, 0.05, 0.15, 0.45, 0.55, 0.5, 0.6, 1.2,
  1.4, 1.0, 0.6, 0.55, 0.9, 1.0, 0.7, 0.4, 0.35, 0.3, 0.15, 0.05];

export const SCENARIOS = [
  { id: 'normal',  label: 'ปกติ' },
  { id: 'near',    label: 'ใกล้เต็ม' },
  { id: 'full',    label: 'เต็ม' },
  { id: 'emptied', label: 'เทแล้ว' },
  { id: 'offline', label: 'ออฟไลน์' },
  { id: 'camera',  label: 'กล้องเสีย' },
  { id: 'servo',   label: 'servo เสีย' },
];
const TARGET = { normal: 46, near: 76, full: 93, emptied: 92, offline: 58, camera: 52, servo: 61 };

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hourOf = (t) => new Date(t + BKK).getUTCHours();
const isWeekend = (t) => { const d = new Date(t + BKK).getUTCDay(); return d === 0 || d === 6; };
const round1 = (v) => Math.round(v * 10) / 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function build(scenario, now) {
  const rnd = mulberry32(20261117);
  const end = scenario === 'offline' ? now - 47 * 60e3
    : scenario === 'emptied' ? now - 9 * 60e3 : now;
  const ts = [];
  for (let t = Math.floor((end - 30 * DAY) / STEP) * STEP; t < end; t += STEP) ts.push(t);
  ts.push(end);

  // 1) ระดับ % พร้อมการเทขยะ
  const tailFrom = end - 18 * 3600e3; // ช่วงท้ายไม่มีการเท เพื่อปรับให้ได้ค่าตามสถานการณ์
  const fill = new Array(ts.length);
  const pickupAt = new Map(); // index -> ระดับก่อนเท
  let f = 2;
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    const h = hourOf(t);
    const wk = isWeekend(t) ? 0.45 : 1;
    const dt = i ? (t - ts[i - 1]) / STEP : 1;
    f += HOURLY[h] * wk * (0.6 + 0.8 * rnd()) * dt;
    if (t < tailFrom) {
      const workHours = !isWeekend(t) && h >= 8 && h <= 17;
      if ((f >= 88 && workHours && rnd() < 0.22) || (f >= 72 && h === 8 && !isWeekend(t) && rnd() < 0.35)) {
        pickupAt.set(i, round1(Math.min(f, 100)));
        f = rnd() * 3;
      }
      f = Math.min(f, 100);
    }
    fill[i] = f;
  }
  // ปรับช่วงหลังการเทครั้งล่าสุดให้จบที่ค่าเป้าหมายของสถานการณ์
  const lastPickup = Math.max(0, ...pickupAt.keys());
  const base = fill[lastPickup];
  const rawEnd = fill[ts.length - 1];
  const k = rawEnd - base > 0.5 ? (TARGET[scenario] - base) / (rawEnd - base) : 1;
  for (let i = lastPickup + 1; i < ts.length; i++) fill[i] = Math.min(100, base + (fill[i] - base) * k);

  // เพิ่งเท: เทเมื่อ 8 นาทีก่อน แล้วมีขยะเพิ่มเล็กน้อย
  if (scenario === 'emptied') {
    pickupAt.set(ts.length, round1(fill[ts.length - 1]));
    [[now - 8 * 60e3, 2.4], [now - 4 * 60e3, 2.9], [now - 20e3, 3.3]].forEach(([t, v]) => { ts.push(t); fill.push(v); });
  }

  // 2) น้ำหนัก + จำนวนชิ้น (รีไซเคิล / ไม่รีไซเคิล)
  const readings = [];
  const pickups = [];
  let rec = 0, non = 0, w = 0, acc = 0;
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    let d;
    if (pickupAt.has(i)) {
      pickups.push({ t, before: pickupAt.get(i), weight_before_g: Math.round(w) });
      rec = 0; non = 0; w = 0; acc = 0; d = fill[i];
    } else {
      d = i ? Math.max(0, fill[i] - fill[i - 1]) : fill[i];
    }
    acc += d / 1.1;
    let ar = 0, an = 0;
    const h = hourOf(t);
    while (acc >= 1) {
      acc -= 1;
      if (rnd() < (h >= 11 && h <= 13 ? 0.3 : 0.45)) { rec++; ar++; w += 25 + rnd() * 30; }
      else { non++; an++; w += 70 + rnd() * 80; }
    }
    readings.push({ t, fill: round1(fill[i]), weight_g: Math.round(w), recycle: rec, non_recycle: non, add_r: ar, add_n: an });
  }

  // 3) อุปกรณ์ (กล้อง / servo)
  const lastSeen = readings[readings.length - 1].t;
  const camera = { ok: true, last_seen: lastSeen, error: null, warning: null,
    info: { model: 'ESP32-CAM', last_result: 'รีไซเคิล (ขวด PET) 94%', fps: 2 } };
  const servo = { ok: true, last_seen: lastSeen, error: null, warning: null,
    info: { model: 'MG996R', last_action: 'เปิดช่องรีไซเคิล', cycles_today: 37 } };
  if (scenario === 'camera') {
    camera.ok = false;
    camera.error = 'ไม่ได้รับภาพจากเซนเซอร์ (Camera init failed 0x105)';
    camera.last_ok = now - 6 * 60e3;
  }
  if (scenario === 'servo') {
    servo.ok = false;
    servo.error = 'ฝาติด: กระแสเกิน 850 mA ที่มุม 62°';
    servo.last_ok = now - 11 * 60e3;
  }

  const incidents = [
    { device: 'camera', state: 'unresponsive', t_start: now - 3 * DAY - 5.2 * 3600e3, t_end: now - 3 * DAY - 4.8 * 3600e3, message: 'ไม่ส่ง heartbeat (WiFi หลุด)' },
    { device: 'servo', state: 'error', t_start: now - 9 * DAY - 2 * 3600e3, t_end: now - 9 * DAY - 1.7 * 3600e3, message: 'ฝาติด: กระแสเกิน' },
    { device: 'camera', state: 'warn', t_start: now - 14 * DAY - 13 * 3600e3, t_end: now - 14 * DAY - 11 * 3600e3, message: 'แสงน้อย ความมั่นใจการจำแนกต่ำ' },
    { device: 'servo', state: 'warn', t_start: now - 21 * DAY - 6 * 3600e3, t_end: now - 21 * DAY - 5.5 * 3600e3, message: 'หมุนไม่สุดลิมิต (ตอบสนองช้า)' },
  ];
  if (scenario === 'camera') incidents.unshift({ device: 'camera', state: 'error', t_start: camera.last_ok, t_end: null, message: camera.error });
  if (scenario === 'servo') incidents.unshift({ device: 'servo', state: 'error', t_start: servo.last_ok, t_end: null, message: servo.error });
  if (scenario === 'offline') {
    incidents.unshift({ device: 'camera', state: 'unresponsive', t_start: lastSeen, t_end: null, message: 'ถังออฟไลน์' },
      { device: 'servo', state: 'unresponsive', t_start: lastSeen, t_end: null, message: 'ถังออฟไลน์' });
  }

  return { scenario, readings, pickups: pickups.reverse(), camera, servo, incidents };
}

export function createMockSource({ binId, binName }) {
  let scenario = 'normal';
  let db = build(scenario, Date.now());
  const live = mulberry32(42);

  // จำลองการส่งข้อมูลทุก ~30 วินาที (ไม่ทำเมื่อออฟไลน์)
  function tick() {
    if (db.scenario === 'offline') return;
    const now = Date.now();
    const r = db.readings;
    const last = r[r.length - 1];
    if (now - last.t < 15e3) return;
    const h = hourOf(now);
    const inc = HOURLY[h] * (isWeekend(now) ? 0.45 : 1) * (0.5 + live()) * ((now - last.t) / STEP);
    const fill = Math.min(100, last.fill + inc);
    let { recycle, non_recycle, weight_g } = last; let ar = 0, an = 0;
    if (live() < inc / 1.1) { if (live() < 0.4) { recycle++; ar++; weight_g += 40; } else { non_recycle++; an++; weight_g += 110; } }
    r.push({ t: now, fill: round1(fill), weight_g, recycle, non_recycle, add_r: ar, add_n: an });
    db.camera.last_seen = now - Math.round(live() * 8e3);
    db.servo.last_seen = now - Math.round(live() * 8e3);
  }

  const latency = () => sleep(120 + Math.random() * 220);

  return {
    kind: 'mock',
    scenarios: SCENARIOS,
    getScenario: () => scenario,
    setScenario(id) {
      if (!TARGET[id]) return;
      scenario = id;
      db = build(id, Date.now());
    },

    // GET /api/bins/:id
    async getBin() {
      await latency(); tick();
      const last = db.readings[db.readings.length - 1];
      return {
        bin_id: binId, name: binName,
        fill: last.fill, weight_g: last.weight_g,
        waste: { recycle: last.recycle, non_recycle: last.non_recycle },
        devices: { camera: { ...db.camera }, servo: { ...db.servo } },
        last_seen: last.t,
      };
    },

    // GET /api/bins/:id/history?range=24h|7d|30d
    async getHistory(range) {
      await latency();
      const now = Date.now();
      const span = range === '30d' ? 30 * DAY : range === '7d' ? 7 * DAY : DAY;
      const bucket = range === '30d' ? 3 * 3600e3 : range === '7d' ? 3600e3 : 0;
      const rows = db.readings.filter((r) => r.t >= now - span);
      if (!bucket) return rows.map(({ t, fill, weight_g, add_r, add_n }) => ({ t, fill, weight_g, recycle: add_r, non_recycle: add_n }));
      const out = [];
      let cur = null;
      for (const r of rows) {
        const b = Math.floor((r.t + BKK) / bucket) * bucket - BKK;
        if (!cur || cur.t !== b) { cur = { t: b, fill: r.fill, weight_g: r.weight_g, recycle: 0, non_recycle: 0 }; out.push(cur); }
        cur.fill = Math.max(cur.fill, r.fill);
        cur.weight_g = r.weight_g;
        cur.recycle += r.add_r; cur.non_recycle += r.add_n;
      }
      return out;
    },

    // GET /api/bins/:id/pickups
    async getPickups() { await latency(); return db.pickups.map((p) => ({ ...p })); },

    // GET /api/bins/:id/events  (เหตุการณ์ที่ส่งแจ้งเตือนไป LINE) — ใหม่สุดก่อน
    async getEvents() {
      await latency();
      const ev = replay(db.readings).events.map((e) => ({ ...e, notified: true }));
      if (db.scenario === 'offline') {
        const last = db.readings[db.readings.length - 1];
        ev.push({ t: last.t + 5 * 60e3, type: 'offline', fill: last.fill, notified: false });
      }
      return ev.reverse();
    },

    // GET /api/bins/:id/devices
    async getDevices() {
      await latency();
      return { camera: { ...db.camera }, servo: { ...db.servo }, incidents: db.incidents.map((x) => ({ ...x })) };
    },
  };
}
