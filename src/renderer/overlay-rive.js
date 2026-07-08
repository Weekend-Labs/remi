// overlay-rive.js — the RB_RIVE=1 path. Loaded lazily by index.html ONLY when the
// URL carries ?rive=1 (main.js appends it when RB_RIVE is set). When the flag is off
// this file is never fetched, so the sprite renderer (overlay.js) is untouched.
//
// It draws the buddy with @rive-app/canvas and drives it through the §4 input contract
// (docs/specs/002-buddy-v2-rive.md) via ViewModel data-binding — the app fires named
// inputs, the .riv owns all animation logic:
//   trigOffer  (trigger)  — reminder shown            → walk-in
//   trigHadIt  (trigger)  — "Had it" pressed          → cheer
//   trigSnooze (trigger)  — "Snooze" pressed          → wave
//   mood       (number)   — 0..100 face blend         (reserved)
//   notifKind  (number)   — 0=water 1=streak 2=slack… (reserved)
//   isPeek     (boolean)  — info-style half-body lean (reserved)
//
// The sprite scene keeps running (bubble text, buttons, timers, IPC actions); only its
// *character* (walker/avatar) is stood down — the Rive canvas draws the buddy instead.
(function () {
  'use strict';

  // Runtime + art are loaded locally (no cloud): the UMD build and its wasm ship in
  // node_modules; buddy.riv sits next to this file.
  const RIVE_JS = '../../node_modules/@rive-app/canvas/rive.js';
  const RIVE_WASM = '../../node_modules/@rive-app/canvas/rive.wasm';
  const RIV_SRC = 'buddy.riv';
  const STATE_MACHINE = 'Buddy';
  const VM_INSTANCE = 'BuddyDefault';

  let inst = null; // bound ViewModelInstance — the handle we fire inputs on

  const trig = (name) => { try { inst && inst.trigger(name) && inst.trigger(name).trigger(); } catch (e) { console.warn('[RB_RIVE] trigger', name, e); } };
  const setNumber = (name, v) => { try { const p = inst && inst.number(name); if (p) p.value = v; } catch (e) { console.warn('[RB_RIVE] number', name, e); } };
  const setBool = (name, v) => { try { const p = inst && inst.boolean(name); if (p) p.value = v; } catch (e) { console.warn('[RB_RIVE] bool', name, e); } };

  // Load the runtime UMD, then boot. Missing runtime/.riv must never break the reminder:
  // we log and leave the sprite path visible.
  const script = document.createElement('script');
  script.src = RIVE_JS;
  script.onerror = () => console.warn('[RB_RIVE] runtime not found at', RIVE_JS, '— staying on sprite path');
  script.onload = boot;
  document.head.appendChild(script);

  function boot() {
    const rive = window.rive;
    if (!rive || !rive.Rive) { console.warn('[RB_RIVE] rive global missing — staying on sprite path'); return; }
    rive.RuntimeLoader.setWasmUrl(RIVE_WASM); // pin local wasm, no CDN fetch

    const canvas = document.getElementById('rivecanvas');
    const r = new rive.Rive({
      src: RIV_SRC,
      canvas,
      stateMachines: [STATE_MACHINE],
      autoplay: true,
      onLoad: () => {
        r.resizeDrawingSurfaceToCanvas();
        const vm = r.defaultViewModel && r.defaultViewModel();
        inst = vm ? ((vm.instanceByName && vm.instanceByName(VM_INSTANCE)) || (vm.defaultInstance && vm.defaultInstance())) : null;
        if (inst) r.bindViewModelInstance(inst);
        else console.warn('[RB_RIVE] no ViewModel instance — inputs will no-op');

        // Rive is live: reveal the canvas and stand the sprite character down (kept in
        // the DOM, just hidden — the bubble/buttons in #scene stay on top).
        canvas.style.display = 'block';
        const style = document.createElement('style');
        style.textContent = 'body.rive-active #walker, body.rive-active #avatar { display: none !important; }';
        document.head.appendChild(style);
        document.body.classList.add('rive-active');
        wireInputs();
      },
      onLoadError: (e) => console.warn('[RB_RIVE]', RIV_SRC, 'failed to load — staying on sprite path', e),
    });

    // expose for the end-to-end proof / debugging
    window.__rive = r;
    window.riveFire = trig;
    window.riveSetNumber = setNumber;
    window.riveSetBool = setBool;
  }

  // Fire the §4 inputs from the existing app event path, alongside overlay.js (both
  // handlers run — preload's onShow/onCelebrate use ipcRenderer.on, which appends).
  function wireInputs() {
    const offer = () => { setNumber('notifKind', 0); setBool('isPeek', false); trig('trigOffer'); };

    // trigOffer on show — the real reminder arrives over IPC…
    window.buddy && window.buddy.onShow && window.buddy.onShow(offer);
    // …and browser tests call window.showReminder() directly, so cover that too.
    const spriteShow = window.showReminder;
    window.showReminder = (data) => { if (typeof spriteShow === 'function') spriteShow(data); offer(); };

    // trigHadIt / trigSnooze on the buttons (added listeners; overlay.js's own handlers
    // still fire the IPC action + sprite reaction).
    const had = document.getElementById('had');
    const snz = document.getElementById('snz');
    if (had) had.addEventListener('click', () => trig('trigHadIt'));
    if (snz) snz.addEventListener('click', () => trig('trigSnooze'));
  }
})();
