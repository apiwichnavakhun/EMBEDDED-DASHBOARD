// แหล่งข้อมูลจริง (รอบหน้า) — เรียก endpoint ตาม DASHBOARD_SPEC ข้อ 6
// คืนค่ารูปแบบเดียวกับ mockSource เพื่อให้ UI ไม่ต้องแก้

// ESP32 ส่งเวลาเป็นวินาที (unix) — แปลงเป็น ms ถ้าค่าน้อยกว่า 1e12
const ms = (t) => (t == null ? t : t < 1e12 ? t * 1000 : t);
const fixDevice = (d) => d && { ...d, last_seen: ms(d.last_seen), last_ok: ms(d.last_ok) };

export function createApiSource({ apiBase, binId }) {
  const url = (p) => `${apiBase}/api/bins/${encodeURIComponent(binId)}${p}`;
  async function get(p) {
    const res = await fetch(url(p), { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${p}`);
    return res.json();
  }

  return {
    kind: 'api',
    scenarios: null,
    async getBin() {
      const b = await get('');
      return {
        ...b,
        last_seen: ms(b.last_seen),
        devices: { camera: fixDevice(b.devices?.camera), servo: fixDevice(b.devices?.servo) },
      };
    },
    async getHistory(range) {
      return (await get(`/history?range=${range}`)).map((r) => ({ ...r, t: ms(r.t) }));
    },
    async getPickups() {
      return (await get('/pickups')).map((p) => ({ ...p, t: ms(p.t) }));
    },
    async getEvents() {
      return (await get('/events')).map((e) => ({ ...e, t: ms(e.t) }));
    },
    async getDevices() {
      const d = await get('/devices');
      return {
        camera: fixDevice(d.camera),
        servo: fixDevice(d.servo),
        incidents: (d.incidents || []).map((x) => ({ ...x, t_start: ms(x.t_start), t_end: ms(x.t_end) })),
      };
    },
  };
}
