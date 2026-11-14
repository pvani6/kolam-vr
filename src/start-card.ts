/**
 * The card people see when they open the link: what Kolam VR is, how to play,
 * and a big Enter VR button (the browser's own button is easy to miss).
 */
import type { World } from '@iwsdk/core';
import { VisibilityState } from '@iwsdk/core';

const CSS = `
#kolam-start{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10;
  width:min(520px,calc(100vw - 32px));box-sizing:border-box;padding:18px 20px 16px;border-radius:18px;
  background:rgba(36,16,18,.88);color:#fbeedd;font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;
  box-shadow:0 10px 30px rgba(0,0,0,.35);backdrop-filter:blur(6px)}
#kolam-start h1{margin:0 0 4px;font-size:22px;color:#ffd98a;font-weight:700}
#kolam-start p{margin:0 0 12px;color:#f1dcc4}
#kolam-start .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
#kolam-start button{font:600 17px system-ui,sans-serif;border:0;border-radius:12px;padding:12px 22px;cursor:pointer;
  background:#ffd98a;color:#3a1a12}
#kolam-start button:focus-visible{outline:3px solid #fff;outline-offset:2px}
#kolam-start .ghost{background:transparent;color:#fbeedd;border:1px solid rgba(251,238,221,.45)}
#kolam-start small{display:block;margin-top:10px;color:#d9bfa5;font-size:13px}
`;

export function addStartCard(world: World): void {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const card = document.createElement('div');
  card.id = 'kolam-start';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Kolam VR — start');
  card.innerHTML = `
    <h1>Kolam VR · கோலம்</h1>
    <p>Draw the doorstep art of Tamil Nadu with your fingertip: one line, woven around the dots, never touching one.</p>
    <div class="row">
      <button id="kolam-enter" hidden>Enter VR</button>
      <button id="kolam-close" class="ghost">Look around first</button>
    </div>
    <small id="kolam-hint">Pinch thumb and finger, like holding rice flour, and draw on the ground. Look at a button and pinch to press it.</small>`;
  document.body.appendChild(card);

  const enter = card.querySelector<HTMLButtonElement>('#kolam-enter')!;
  const close = card.querySelector<HTMLButtonElement>('#kolam-close')!;
  const hint = card.querySelector<HTMLElement>('#kolam-hint')!;

  close.addEventListener('click', () => (card.style.display = 'none'));
  enter.addEventListener('click', () => {
    try {
      world.launchXR();
    } catch (e) {
      hint.textContent = 'Could not start VR here. Open this link in the Meta Quest browser.';
      console.warn(e);
    }
  });

  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (xr?.isSessionSupported) {
    xr.isSessionSupported('immersive-vr')
      .then((ok) => {
        if (ok) {
          enter.hidden = false;
          close.textContent = 'Look around first';
        } else {
          close.textContent = 'Play here with the mouse';
          hint.textContent =
            'For the full game, open this link in the Meta Quest browser. Here: drag with the mouse to draw; keys N/P next/previous kolam, D shows how.';
        }
      })
      .catch(() => undefined);
  } else {
    close.textContent = 'Play here with the mouse';
    hint.textContent = 'For the full game, open this link in the Meta Quest browser. Here: drag with the mouse to draw.';
  }

  // Hide while in VR; show again when you come back out
  world.visibilityState.subscribe((v) => {
    card.style.display = v === VisibilityState.NonImmersive ? '' : 'none';
  });
}
