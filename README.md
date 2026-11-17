# CEDT SmartBin – Dashboard (ต้นแบบ v2)

หน้า Dashboard สำหรับเจ้าของถังขยะ ทำตาม `DASHBOARD_SPEC.md`
- เป็นเว็บแบบ static ล้วน (HTML + CSS + JavaScript modules) **ไม่ต้อง build**
- กราฟใช้ Chart.js 4.4.1 (ไฟล์อยู่ใน `public/vendor/`)
- ฟอนต์ Unifont (`public/fonts/`)
- รอบนี้ใช้ **ข้อมูลจำลอง (mock)** ทั้งหมด ยังไม่ต่อ ESP32

## โครงสร้าง

```
dashboard/
├─ vercel.json            ตั้งค่า Vercel (เสิร์ฟโฟลเดอร์ public/, cache ฟอนต์/รูป)
├─ package.json           สคริปต์ dev / deploy (ไม่มี dependency)
└─ public/
   ├─ index.html
   ├─ css/style.css       ธีม pixel (สว่าง/มืดตามเครื่อง), mobile-first
   ├─ img/                น้องถังขยะ 5 อารมณ์ (normal/alert/full/happy/sleep)
   ├─ js/
   │  ├─ config.js        เลือกแหล่งข้อมูล mock / api
   │  ├─ app.js           สลับหน้า (#/history), รีเฟรชทุก 30 วิ, pull-to-refresh
   │  ├─ data/            ← ชั้นข้อมูล (แยกจาก UI)
   │  │  ├─ status.js     กติกาสถานะ 70/90/10%, hysteresis 5%, ออฟไลน์ 5 นาที (ตรงกับ server/logic.js)
   │  │  ├─ mockSource.js ข้อมูลจำลอง 30 วัน + 7 สถานการณ์
   │  │  ├─ apiSource.js  เรียก API จริง (รอบหน้า)
   │  │  └─ repository.js รวมข้อมูล + คำนวณสถานะ / พยากรณ์ / สถิติ (UI เรียกเฉพาะไฟล์นี้)
   │  └─ ui/              home.js, history.js, charts.js, sheet.js, format.js
   └─ vendor/chart.umd.min.js
```

## รันบนเครื่อง

```bash
cd dashboard && npm run dev
```
แล้วเปิด http://localhost:5173 (ใช้ `python3 -m http.server 5173 -d public` แทนก็ได้)
ห้ามเปิดไฟล์ index.html ตรงๆ เพราะ ES modules ต้องเสิร์ฟผ่าน http

## Deploy ขึ้น Vercel

**วิธี A: ผ่าน Git (แนะนำ)**
1. push โปรเจกต์ขึ้น GitHub
2. ที่ vercel.com → Add New → Project → เลือก repo
3. ตั้ง **Root Directory = `smartbin_function1/dashboard`**
4. Framework Preset = **Other** และไม่ต้องใส่ Build Command (vercel.json ตั้ง Output Directory = `public` ไว้แล้ว)
5. Deploy

**วิธี B: ใช้ CLI**
```bash
cd smartbin_function1/dashboard && npx vercel --prod
```
ครั้งแรกจะถามให้ล็อกอินและตั้งชื่อโปรเจกต์ ให้ตอบตามค่าเริ่มต้นได้เลย

## โหมดตัวอย่างสถานะ

หน้าหลักมีแถว "ดูตัวอย่างสถานะ" สลับได้ 7 แบบ: ปกติ / ใกล้เต็ม / เต็ม / เทแล้ว / ออฟไลน์ / กล้องเสีย / servo เสีย
- เบราว์เซอร์จะจำแบบที่เลือกไว้
- แถวนี้จะซ่อนเองเมื่อเปลี่ยนเป็น API จริง

## เปลี่ยนจาก mock เป็น API จริง (รอบหน้า)

1. ให้เซิร์ฟเวอร์มี endpoint ตาม Data contract ด้านล่าง
2. แก้ `dataSource: 'api'` ใน `public/js/config.js`
   - ถ้า API อยู่คนละโดเมน ให้ใส่ `apiBase` และเปิด CORS ที่เซิร์ฟเวอร์
   - ทดลองก่อนแก้ไฟล์ได้ด้วย URL `?source=api&api=https://<server>`

ไม่ต้องแก้ไฟล์ UI เลย

### Data contract

เวลาเป็น unix ms หรือ unix seconds ก็ได้ (apiSource แปลงให้)

| Endpoint | คืนค่า |
|---|---|
| `GET /api/bins/:id` | `{ bin_id, name, fill, weight_g, waste:{recycle, non_recycle}, devices:{camera, servo}, last_seen }` |
| `GET /api/bins/:id/history?range=24h\|7d\|30d` | `[{ t, fill, weight_g, recycle, non_recycle }]` |
| `GET /api/bins/:id/pickups` | `[{ t, before, weight_before_g? }]` ใหม่สุดก่อน |
| `GET /api/bins/:id/events` | `[{ t, type:'near'\|'full'\|'emptied'\|'offline', fill, notified }]` ใหม่สุดก่อน |
| `GET /api/bins/:id/devices` | `{ camera, servo, incidents:[{ device, state, t_start, t_end, message }] }` |

รายละเอียดเพิ่มเติม:
- **history**
  - 24h = ทุกจุดที่ ESP32 ส่งมา
  - 7d = จุดละ 1 ชม. และ 30d = จุดละ 3 ชม.
  - `fill` ของแต่ละจุดเป็นค่าสูงสุดในช่วงนั้น
  - `recycle` / `non_recycle` คือจำนวนชิ้นที่ **เพิ่มขึ้น** ในช่วงนั้น
- **device**
  - รูปแบบ: `{ ok, last_seen, error, warning?, last_ok?, info? }`
  - ถ้าไม่ได้ heartbeat เกิน 2 นาที หน้าเว็บจะแสดง "ไม่ตอบสนอง"
