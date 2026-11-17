// Bottom sheet: เปิดจากล่าง ปิดด้วยแตะพื้นหลัง / ปุ่มปิด / Esc / ปัดลง
let root, panel, body, lastFocus, onCloseCb;

function ensure() {
  if (root) return;
  root = document.createElement('div');
  root.className = 'sheet-root';
  root.hidden = true;
  root.innerHTML = `
    <div class="sheet-backdrop" data-close></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sheet-body"></div>
      <button class="btn btn-block" data-close>ปิด</button>
    </div>`;
  document.body.appendChild(root);
  panel = root.querySelector('.sheet');
  body = root.querySelector('.sheet-body');
  root.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.hidden) closeSheet(); });

  // ปัดลงเพื่อปิด
  let y0 = null, dy = 0;
  panel.addEventListener('touchstart', (e) => { if (panel.scrollTop <= 0) { y0 = e.touches[0].clientY; dy = 0; } }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    panel.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  panel.addEventListener('touchend', () => {
    if (y0 == null) return;
    panel.style.transform = '';
    if (dy > 90) closeSheet();
    y0 = null;
  });
}

export function openSheet(html, onClose) {
  ensure();
  lastFocus = document.activeElement;
  onCloseCb = onClose;
  body.innerHTML = html;
  root.hidden = false;
  requestAnimationFrame(() => root.classList.add('open'));
  panel.focus();
}

export function updateSheet(html) {
  if (root && !root.hidden) body.innerHTML = html;
}

export function isSheetOpen() { return root && !root.hidden; }

export function closeSheet() {
  if (!root || root.hidden) return;
  root.classList.remove('open');
  setTimeout(() => { root.hidden = true; }, 200);
  onCloseCb?.();
  lastFocus?.focus?.();
}
