const TZ = 'Asia/Bangkok';
const timeF = new Intl.DateTimeFormat('th-TH', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const dateF = new Intl.DateTimeFormat('th-TH', { timeZone: TZ, day: 'numeric', month: 'short' });
const dayKeyF = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });

export const fmtTime = (t) => timeF.format(t);
export const fmtDate = (t) => dateF.format(t);
export const fmtDateTime = (t) => `${fmtDate(t)} ${fmtTime(t)}`;

export function dayLabel(t, now = Date.now()) {
  const k = dayKeyF.format(t);
  if (k === dayKeyF.format(now)) return 'วันนี้';
  if (k === dayKeyF.format(now + 864e5)) return 'พรุ่งนี้';
  if (k === dayKeyF.format(now - 864e5)) return 'เมื่อวาน';
  return fmtDate(t);
}

export function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return 'เมื่อสักครู่';
  if (s < 60) return `${s} วินาทีที่แล้ว`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ชม. ที่แล้ว`;
  return `${Math.floor(h / 24)} วันที่แล้ว`;
}

export function dur(ms) {
  const m = Math.round(ms / 60e3);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d) return h ? `${d} วัน ${h} ชม.` : `${d} วัน`;
  if (h) return mm ? `${h} ชม. ${mm} นาที` : `${h} ชม.`;
  return `${mm} นาที`;
}

export const fmtKg = (g) => (g / 1000).toFixed(1);
export const pad2 = (n) => String(n).padStart(2, '0');

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
