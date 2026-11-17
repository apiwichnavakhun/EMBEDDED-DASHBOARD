// ตั้งค่าหน้า Dashboard
// เปลี่ยน dataSource เป็น 'api' เมื่อเซิร์ฟเวอร์มี endpoint ตาม README แล้ว
// หรือทดลองผ่าน URL: ?source=api&api=https://your-server.example.com
const params = new URLSearchParams(location.search);

export const CONFIG = {
  dataSource: params.get('source') || 'mock', // 'mock' | 'api'
  apiBase: params.get('api') || '',            // '' = โดเมนเดียวกับหน้าเว็บ
  binId: params.get('bin') || 'bin1',
  binName: 'ถังขยะ CEDT ชั้น 1',
  refreshMs: 30_000,                            // ตามรอบส่งข้อมูลของ ESP32
};
