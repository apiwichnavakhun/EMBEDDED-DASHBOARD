// ชั้นข้อมูลที่ UI เรียกใช้ — รวมข้อมูลจาก source (mock หรือ api) แล้วคำนวณสิ่งที่หน้าจอต้องใช้
// UI ห้ามเรียก source ตรงๆ เพื่อให้สลับ mock -> api ได้โดยไม่แก้ UI
import { CFG, replay, deriveStatus, deriveDevice, levelOf } from './status.js';
import { createMockSource } from './mockSource.js';
import { createApiSource } from './apiSource.js';

const H = 3600e3;
const DAY = 24 * H;
const BKK = 7 * H;
const hourOf = (t) => new Date(t + BKK).getUTCHours();

export function createSource(config) {
  return config.dataSource === 'api' ? createApiSource(config) : createMockSource(config);
}

/** อัตราเพิ่มเฉลี่ย (% ต่อชั่วโมง) แยกตามชั่วโมงของวัน จากข้อมูลรายชั่วโมง 7 วัน
 *  (จุดรายชั่วโมงเก็บค่าสูงสุดของชั่วโมง ส่วนต่างระหว่างจุด = ขยะที่เพิ่มในชั่วโมงของจุดหลัง) */
function hourlyProfile(points) {
  const sum = new Array(24).fill(0), n = new Array(24).fill(0);
  for (let i = 1; i < points.length; i++) {
    const d = points[i].fill - points[i - 1].fill;
    const dtH = (points[i].t - points[i - 1].t) / H;
    if (dtH <= 0 || dtH > 3 || d < 0 || points[i - 1].fill >= 99) continue; // ข้ามช่วงเท/ช่องว่าง/ถังเต็ม
    const h = hourOf(points[i].t);
    sum[h] += d / dtH; n[h]++;
  }
  return sum.map((s, h) => (n[h] ? s / n[h] : 0));
}

/** พยากรณ์เวลาที่ถึง 90% โดยเดินตามพฤติกรรมรายชั่วโมงย้อนหลัง */
function forecastFull(fill, now, profile) {
  if (fill >= CFG.full) return { reached: true };
  if (!profile.some((v) => v > 0)) return null;
  let f = fill, t = now;
  const stepMs = 10 * 60e3;
  while (t - now < 3 * DAY) {
    f += profile[hourOf(t)] * (stepMs / H);
    t += stepMs;
    if (f >= CFG.full) return { t };
  }
  return { beyond: true };
}

function peakWindow(profile) {
  let best = 0, at = 0;
  for (let h = 0; h < 24; h++) {
    const v = profile[h] + profile[(h + 1) % 24];
    if (v > best) { best = v; at = h; }
  }
  return best > 0 ? { from: at, to: (at + 2) % 24, rate: best / 2 } : null;
}

function wasteBuckets(points, range) {
  const size = range === '24h' ? 2 * H : DAY;
  const map = new Map();
  for (const p of points) {
    const k = Math.floor((p.t + BKK) / size) * size - BKK;
    const b = map.get(k) || { t: k, recycle: 0, non_recycle: 0 };
    b.recycle += p.recycle || 0; b.non_recycle += p.non_recycle || 0;
    map.set(k, b);
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

export function createRepository(source) {
  return {
    isMock: source.kind === 'mock',
    scenarios: source.scenarios,
    getScenario: () => source.getScenario?.(),
    setScenario: (id) => source.setScenario?.(id),

    async getHome() {
      const [bin, events, h24, h7] = await Promise.all([
        source.getBin(), source.getEvents(), source.getHistory('24h'), source.getHistory('7d'),
      ]);
      const now = Date.now();
      const level = h24.length ? replay(h24).level : levelOf(bin.fill);
      const lastEmptied = events.find((e) => e.type === 'emptied');
      const status = deriveStatus({ level, fill: bin.fill, lastSeen: bin.last_seen, lastEmptiedAt: lastEmptied?.t, now });
      const profile = hourlyProfile(h7);
      const hourAgo = [...h24].reverse().find((p) => p.t <= now - H);
      const total = (bin.waste?.recycle || 0) + (bin.waste?.non_recycle || 0);
      return {
        name: bin.name,
        fill: bin.fill,
        status,
        lastSeen: bin.last_seen,
        online: status !== 'offline',
        forecast: status === 'offline' ? null : forecastFull(bin.fill, now, profile),
        weight: { g: bin.weight_g, delta1h: hourAgo ? bin.weight_g - hourAgo.weight_g : null },
        waste: {
          recycle: bin.waste?.recycle || 0,
          non_recycle: bin.waste?.non_recycle || 0,
          total,
          pctRecycle: total ? Math.round((bin.waste.recycle / total) * 100) : 0,
        },
        devices: {
          camera: { ...bin.devices.camera, state: deriveDevice(bin.devices.camera, now) },
          servo: { ...bin.devices.servo, state: deriveDevice(bin.devices.servo, now) },
        },
        recent: h24.slice(-36), // 6 ชม. ล่าสุด ใช้ทำ sparkline
      };
    },

    async getDevices() {
      const d = await source.getDevices();
      const now = Date.now();
      return {
        camera: { ...d.camera, state: deriveDevice(d.camera, now) },
        servo: { ...d.servo, state: deriveDevice(d.servo, now) },
        incidents: d.incidents,
      };
    },

    async getHistory(range) {
      const [points, h7, pickups, events, devices] = await Promise.all([
        source.getHistory(range),
        range === '7d' ? null : source.getHistory('7d'),
        source.getPickups(), source.getEvents(), this.getDevices(),
      ]);
      const now = Date.now();
      const profile = hourlyProfile(range === '7d' ? points : h7);
      const since = now - (range === '30d' ? 30 : range === '7d' ? 7 : 1) * DAY;

      const p30 = pickups.filter((p) => p.t >= now - 30 * DAY);
      const withGap = p30.map((p, i) => ({ ...p, gap: p30[i + 1] ? p.t - p30[i + 1].t : null }));
      const gaps = withGap.map((p) => p.gap).filter(Boolean);
      const wasteR = points.reduce((s, p) => s + (p.recycle || 0), 0);
      const wasteN = points.reduce((s, p) => s + (p.non_recycle || 0), 0);

      return {
        range,
        points,
        events: events.filter((e) => e.t >= since),
        allEvents: events.filter((e) => e.t >= now - 30 * DAY),
        pickups: withGap,
        stats: {
          lastPickup: withGap[0] || null,
          avgInterval: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
          count30: p30.length,
          peak: peakWindow(profile),
          avgBefore: p30.length ? Math.round(p30.reduce((s, p) => s + p.before, 0) / p30.length) : null,
        },
        waste: { buckets: wasteBuckets(points, range), recycle: wasteR, non_recycle: wasteN },
        devices,
      };
    },
  };
}
