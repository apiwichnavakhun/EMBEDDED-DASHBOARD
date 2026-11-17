// จุดเริ่ม: สร้างชั้นข้อมูล → ผูกหน้า → จัดการสลับหน้า (hash) / รีเฟรชอัตโนมัติ / pull-to-refresh
import { CONFIG } from './config.js';
import { createSource, createRepository } from './data/repository.js';
import { mountHome } from './ui/home.js';
import { mountHistory } from './ui/history.js';
import { closeSheet } from './ui/sheet.js';

const repo = createRepository(createSource(CONFIG));
const homeEl = document.getElementById('view-home');
const histEl = document.getElementById('view-history');

// จำสถานการณ์ตัวอย่างที่เลือกไว้ (เฉพาะเบราว์เซอร์นี้)
if (repo.isMock) {
  try { const s = localStorage.getItem('smartbin.scenario'); if (s) repo.setScenario(s); } catch { /* ignore */ }
}

let cameFromHome = false;
const home = mountHome(homeEl, repo, {
  onOpenHistory: () => { cameFromHome = true; location.hash = '#/history'; },
  onScenarioChange: (id) => { try { localStorage.setItem('smartbin.scenario', id); } catch { /* ignore */ } },
});
const hist = mountHistory(histEl, repo, {
  onBack: () => { if (cameFromHome) history.back(); else location.hash = ''; },
});

let current = null;
function route() {
  const next = location.hash === '#/history' ? 'history' : 'home';
  if (next === current) return;
  closeSheet();
  const show = next === 'history' ? histEl : homeEl;
  const hide = next === 'history' ? homeEl : histEl;
  hide.hidden = true;
  show.hidden = false;
  show.classList.remove('enter-fwd', 'enter-back');
  void show.offsetWidth;
  show.classList.add(next === 'history' ? 'enter-fwd' : 'enter-back');
  window.scrollTo(0, 0);
  if (next === 'history') { hist.open(); document.title = 'ข้อมูลย้อนหลัง · CEDT SmartBin'; }
  else {
    hist.close(); cameFromHome = false;
    document.title = 'CEDT SmartBin';
    if (current) home.refresh();
  }
  current = next;
  show.querySelector('h1')?.setAttribute('tabindex', '-1');
  if (current && next) show.querySelector('h1')?.focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);
route();
home.refresh();

function refreshActive() {
  if (current === 'history') hist.refresh(); else home.refresh();
}

// อัปเดตอัตโนมัติทุก ~30 วินาที (หยุดเมื่อแท็บถูกซ่อน)
let timer = setInterval(refreshActive, CONFIG.refreshMs);
document.addEventListener('visibilitychange', () => {
  clearInterval(timer);
  if (!document.hidden) { refreshActive(); timer = setInterval(refreshActive, CONFIG.refreshMs); }
});
setInterval(() => home.tickClock(), 5000);

// เปลี่ยนธีมสว่าง/มืด → วาดกราฟใหม่ด้วยสีของธีมนั้น
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => hist.rerender());

// Pull-to-refresh (มือถือ)
const ptr = document.getElementById('ptr');
let y0 = null, pulled = 0;
window.addEventListener('touchstart', (e) => {
  if (window.scrollY <= 0 && !document.querySelector('.sheet-root.open')) { y0 = e.touches[0].clientY; pulled = 0; }
}, { passive: true });
window.addEventListener('touchmove', (e) => {
  if (y0 == null) return;
  pulled = Math.max(0, Math.min(110, (e.touches[0].clientY - y0) * 0.5));
  ptr.style.transform = `translateY(${pulled - 48}px)`;
  ptr.classList.toggle('ready', pulled > 60);
  ptr.textContent = pulled > 60 ? 'ปล่อยเพื่อรีเฟรช' : 'ดึงลงเพื่อรีเฟรช';
}, { passive: true });
window.addEventListener('touchend', () => {
  if (y0 == null) return;
  if (pulled > 60) { ptr.textContent = 'กำลังรีเฟรช…'; refreshActive(); }
  setTimeout(() => { ptr.style.transform = ''; ptr.classList.remove('ready'); }, pulled > 60 ? 600 : 0);
  y0 = null;
});
