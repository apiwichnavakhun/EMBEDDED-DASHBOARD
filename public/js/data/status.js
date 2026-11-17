// กติกาสถานะ (ตรงกับ server/logic.js และ LINE) — ไม่มี DOM ไม่มีเครือข่าย
export const CFG = {
  near: 70,              // ใกล้เต็ม
  full: 90,              // เต็ม
  emptyAt: 10,           // ถือว่าว่าง (เทแล้ว)
  hyst: 5,               // กันค่ากระพริบ
  offlineMs: 5 * 60e3,   // ไม่ได้รับข้อมูลเกิน 5 นาที = ออฟไลน์
  emptiedShowMs: 30 * 60e3, // แสดงป้าย "เพิ่งเทแล้ว" นานเท่าไรหลังเท
  deviceStaleMs: 2 * 60e3,  // อุปกรณ์ไม่ส่ง heartbeat เกินนี้ = ไม่ตอบสนอง
};

/** ระดับถัดไปแบบมี hysteresis — สำเนาตรรกะจาก server/logic.js */
export function step(prev, fill, armed = false) {
  let level, event = null;
  if (fill >= CFG.full) {
    level = 'full'; if (prev !== 'full') event = 'full';
  } else if (prev === 'full' && fill >= CFG.full - CFG.hyst) {
    level = 'full';
  } else if (fill >= CFG.near) {
    level = 'near'; if (prev === 'ok') event = 'near';
  } else if (prev === 'near' && fill >= CFG.near - CFG.hyst) {
    level = 'near';
  } else {
    level = 'ok';
  }
  if (level !== 'ok') armed = true;
  if (armed && fill <= CFG.emptyAt) { event = 'emptied'; armed = false; level = 'ok'; }
  return { level, event, armed };
}

export function levelOf(fill) {
  return fill >= CFG.full ? 'full' : fill >= CFG.near ? 'near' : 'ok';
}

/** เล่นค่าย้อนหลังผ่าน step() เพื่อหาระดับปัจจุบันและเหตุการณ์ */
export function replay(readings) {
  let level = readings.length ? levelOf(readings[0].fill) : 'ok';
  let armed = level !== 'ok';
  const events = [];
  for (const r of readings) {
    const s = step(level, r.fill, armed);
    if (s.event) events.push({ t: r.t, type: s.event, fill: r.fill });
    level = s.level; armed = s.armed;
  }
  return { level, armed, events };
}

/** สถานะที่โชว์บนหน้าจอ: ok | near | full | emptied | offline */
export function deriveStatus({ level, fill, lastSeen, lastEmptiedAt, now }) {
  if (now - lastSeen > CFG.offlineMs) return 'offline';
  if (lastEmptiedAt && now - lastEmptiedAt < CFG.emptiedShowMs && fill <= CFG.emptyAt + CFG.hyst) return 'emptied';
  return level;
}

/** สถานะอุปกรณ์: ok | warn | error | unresponsive */
export function deriveDevice(d, now) {
  if (!d || !d.last_seen || now - d.last_seen > CFG.deviceStaleMs) return 'unresponsive';
  if (!d.ok) return 'error';
  if (d.warning) return 'warn';
  return 'ok';
}

export const STATUS_META = {
  ok:      { label: 'ปกติ',        mascot: 'normal', advice: 'ยังมีที่ว่างอีกเยอะ ใช้งานได้ตามปกติ' },
  near:    { label: 'ใกล้เต็ม',     mascot: 'alert',  advice: 'ควรเตรียมเทขยะเร็วๆ นี้' },
  full:    { label: 'เต็มแล้ว',     mascot: 'full',   advice: 'ควรเทขยะทันที ก่อนขยะล้นถัง' },
  emptied: { label: 'เพิ่งเทแล้ว',  mascot: 'happy',  advice: 'เทเรียบร้อย ถังพร้อมใช้งาน ขอบคุณครับ!' },
  offline: { label: 'ออฟไลน์',     mascot: 'sleep',  advice: 'ไม่ได้รับข้อมูลจากถังเกิน 5 นาที ลองตรวจไฟและ WiFi ของ ESP32' },
};

export const DEVICE_META = {
  ok:           { label: 'ปกติ' },
  warn:         { label: 'เตือน' },
  error:        { label: 'ผิดปกติ' },
  unresponsive: { label: 'ไม่ตอบสนอง' },
};

export const EVENT_META = {
  near:    { label: 'ใกล้เต็ม',  status: 'near' },
  full:    { label: 'เต็มแล้ว',  status: 'full' },
  emptied: { label: 'เทแล้ว',    status: 'emptied' },
  offline: { label: 'ออฟไลน์',   status: 'offline' },
};
