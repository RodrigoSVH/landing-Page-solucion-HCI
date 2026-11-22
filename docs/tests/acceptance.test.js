/* =========================================================
   Pruebas de aceptación · FocusSync (30 HU core)
   Uso:
     npm install                      (en docs/tests)
     BASE_URL=https://USUARIO.github.io/REPO/pages/index.html node acceptance.test.js
   Sin BASE_URL se prueba el archivo local ../../pages/index.html
   Genera results/resultados.json y results/resultados.md
   Variables opcionales: PUPPETEER_PATH, CHROME_PATH, AXE_PATH
   ========================================================= */
const fs = require('fs');
const path = require('path');
const puppeteer = require(process.env.PUPPETEER_PATH || 'puppeteer');
const AXE_PATH = process.env.AXE_PATH || require.resolve('axe-core/axe.min.js');
const AXE_SRC = fs.readFileSync(AXE_PATH, 'utf8');
const BASE = process.env.BASE_URL || 'file://' + path.resolve(__dirname, '../../pages/index.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const urlTS = (ts) => BASE + (BASE.includes('?') ? '&' : '?') + 'timescale=' + ts;

const resultados = [];
let browser;
const tests = [];
function test(id, hu, criterio, accion, esperado, ts, fn) { tests.push({ id, hu, criterio, accion, esperado, ts, fn }); }
function check(cond, obtenido) { if (!cond) { const e = new Error(obtenido); e.obtenido = obtenido; throw e; } return obtenido; }

async function abrir(ts = 1, opts = {}) {
  const ctx = browser.createBrowserContext ? await browser.createBrowserContext() : await browser.createIncognitoBrowserContext();
  const page = await ctx.newPage();
  page.__dialogs = 0; page.__reqs = []; page.__loaded = false;
  page.on('dialog', (d) => { page.__dialogs++; d.dismiss(); });
  page.on('request', (r) => { if (page.__loaded && ['fetch', 'xhr', 'websocket', 'eventsource', 'ping'].includes(r.resourceType())) page.__reqs.push(r.url()); });
  await page.setViewport({ width: opts.w || 1366, height: opts.h || 900 });
  if (opts.reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluateOnNewDocument(() => {
    document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = 'html{scroll-behavior:auto !important}'; document.head.appendChild(s); });   // evita clics a mitad de un desplazamiento suave
    window.__audio = 0; window.__capture = 0;
    const A = window.Audio; window.Audio = function () { window.__audio++; return new A(...arguments); };
    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
      const g = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getDisplayMedia = function () { window.__capture++; return g.apply(null, arguments); };
    }
  });
  await page.goto(urlTS(ts), { waitUntil: 'load' });
  page.__loaded = true;
  return { page, ctx, close: async () => { try { await ctx.close(); } catch (e) { /* ignorado */ } } };
}
const st = (page) => page.evaluate(() => window.FocusSync.estado());
const txt = (page, sel) => page.$eval(sel, (e) => e.textContent.trim());
const vis = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || e.hidden) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; }, sel);
const cs = (page, sel, prop) => page.$eval(sel, (e, p) => getComputedStyle(e).getPropertyValue(p), prop);
const setRange = (page, v) => page.evaluate((x) => { const r = document.getElementById('sensibilidad'); r.value = x; r.dispatchEvent(new Event('input', { bubbles: true })); }, String(v));
async function erratico(page, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) await page.mouse.move(80 + Math.random() * 1100, 120 + Math.random() * 600); }
async function oyentes(page, tipo) {
  const c = await page.target().createCDPSession();
  const { result } = await c.send('Runtime.evaluate', { expression: 'document' });
  const { listeners } = await c.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
  await c.detach();
  return listeners.filter((l) => l.type === tipo).length;
}
const combo = async (page, mods, key) => { for (const m of mods) await page.keyboard.down(m); await page.keyboard.press(key); for (const m of [...mods].reverse()) await page.keyboard.up(m); };
const simular = (page, o) => page.evaluate((x) => window.FocusSync.simular(x), o);
const toastTipo = (page, t) => page.evaluate((x) => !!document.querySelector(`.toast[data-tipo="${x}"]`), t);

/* ======================= HU-001 ======================= */
test('PA-01', 'HU-001', 'CA01', 'Abrir la página sin interactuar y luego mover el cursor', 'El contador de tiempo continuo inicia solo al detectar un evento de entrada', 30, async (p) => {
  await sleep(500); const a = await st(p);
  check(a.continuoMs === 0, `Antes de interactuar: ${a.continuoMs} ms`);
  await p.mouse.move(300, 300); await p.mouse.move(340, 320); await sleep(1100);
  const b = await st(p);
  return check(b.continuoMs > 20000, `Antes: 0 ms; después de mover el cursor: ${Math.round(b.continuoMs / 1000)} s virtuales`);
});
test('PA-02', 'HU-001', 'CA02', 'Simular 5 min de inactividad total', 'El contador se pausa automáticamente', 30, async (p) => {
  await p.mouse.move(300, 300); await p.mouse.move(340, 320); await sleep(300);
  await p.evaluate(() => window.FocusSync.forzarIdle(301000)); await sleep(150);
  const a = await st(p); await sleep(400); const b = await st(p);
  check(a.idle === true, 'No entró en pausa automática');
  return check(Math.abs(b.continuoMs - a.continuoMs) < 1500, `idle=true; el contador no avanzó (${Math.round(a.continuoMs)} -> ${Math.round(b.continuoMs)} ms)`);
});
test('PA-03', 'HU-001', 'CA03', 'Registrar tiempo durante varios segundos', 'No aparece ningún modal ni diálogo invasivo', 30, async (p) => {
  await p.mouse.move(300, 300); await p.mouse.move(340, 320); await sleep(1000);
  const n = await p.evaluate(() => document.querySelectorAll('.dialog-backdrop:not([hidden])').length);
  return check(n === 0 && p.__dialogs === 0, `Diálogos visibles: ${n}; alert/confirm: ${p.__dialogs}`);
});

/* ======================= HU-002 ======================= */
test('PA-04', 'HU-002', 'CA01', 'Mover el cursor de forma errática y revisar si se usó captura de pantalla', 'Se mide velocidad y trayectoria sin capturar pantalla', 10, async (p) => {
  await erratico(p, 1500);
  const cap = await p.evaluate(() => window.__capture);
  const s = await st(p);
  return check(cap === 0 && s.dispersionSeg > 0, `Llamadas a captura de pantalla: ${cap}; dispersión acumulada: ${s.dispersionSeg.toFixed(1)} s`);
});
test('PA-05', 'HU-002', 'CA02', 'Comparar movimiento recto con movimiento errático', 'La entropía de trayectoria distingue ambos casos', 10, async (p) => {
  for (let i = 0; i < 120; i++) await p.mouse.move(100 + i * 8, 400);          // trayectoria recta
  await sleep(900); const recto = (await st(p)).dispersionSeg;
  await erratico(p, 1500); const err = (await st(p)).dispersionSeg;
  return check(recto < 3 && err > recto + 5, `Dispersión en trayectoria recta: ${recto.toFixed(1)} s; errática: ${err.toFixed(1)} s`);
});
test('PA-06', 'HU-002', 'CA03', 'Mantener movimiento errático hasta superar 90 s virtuales', 'No se cataloga antes de 90 s; al superarlos el componente de cursor llega al máximo', 10, async (p) => {
  const t0 = Date.now(); let parcial = null;
  while ((await st(p)).dispersionSeg < 92 && Date.now() - t0 < 20000) {
    await erratico(p, 400);
    const s = await st(p);
    if (parcial === null && s.dispersionSeg >= 40) { await p.evaluate(() => window.FocusSync.calcular()); parcial = { seg: s.dispersionSeg, cur: (await st(p)).comps.cur }; }
  }
  await p.evaluate(() => window.FocusSync.calcular());
  const s = await st(p);
  return check(parcial && parcial.cur < 1 && s.dispersionSeg >= 90 && s.comps.cur === 1, `A los ${parcial && parcial.seg.toFixed(0)} s el componente de cursor era ${parcial && parcial.cur.toFixed(2)} (< 1); a los ${s.dispersionSeg.toFixed(0)} s llegó a ${s.comps.cur}`);
});

/* ======================= HU-003 ======================= */
test('PA-07', 'HU-003', 'CA01 y CA03', 'Escribir 20 caracteres y borrar 15 (borrado > 40 %)', 'Se mide la tasa de borrado y se marca la señal de tecleo', 30, async (p) => {
  await p.click('#documento', { clickCount: 3 }); await p.keyboard.press('Backspace');
  await p.keyboard.type('abcdefghijklmnopqrst', { delay: 5 });
  for (let i = 0; i < 15; i++) await p.keyboard.press('Backspace');
  await p.evaluate(() => window.FocusSync.calcular());
  const s = await st(p);
  return check(s.borrado >= 0.4 && s.comps.typ === 1, `Tasa de borrado: ${(s.borrado * 100).toFixed(0)} %; componente de tecleo: ${s.comps.typ}`);
});
test('PA-08', 'HU-003', 'CA02', 'Escribir una frase única y buscarla en todo el almacenamiento y estado', 'El texto escrito no existe en ningún lugar accesible', 1, async (p) => {
  const secreto = 'ZZSECRETO_ContraseñaXYZ987';
  await p.click('#documento'); await p.keyboard.type(secreto, { delay: 3 }); await sleep(400);
  const r = await p.evaluate((s) => {
    const blob = JSON.stringify([window.FocusSync.store(), window.FocusSync.estado(), { ...localStorage }, { ...sessionStorage }, document.getElementById('inspector-datos').textContent]);
    return blob.includes(s);
  }, secreto);
  return check(r === false, `Texto encontrado en almacenamiento/estado: ${r}`);
});

/* ======================= HU-004 ======================= */
test('PA-09', 'HU-004', 'CA01 a CA03', 'Provocar 13 pérdidas de foco de la ventana en menos de 60 s', 'Se detecta alternancia > 12 sin cerrar nada ni mostrar bloqueos', 30, async (p) => {
  for (let i = 0; i < 13; i++) { await p.evaluate(() => window.dispatchEvent(new Event('blur'))); await sleep(14); }
  await p.evaluate(() => window.FocusSync.calcular());
  const s = await st(p);
  const bloqueos = await p.evaluate(() => document.querySelectorAll('.dialog-backdrop:not([hidden])').length);
  return check(s.ventanas60 > 12 && s.comps.win === 1 && bloqueos === 0, `Cambios en 60 s: ${s.ventanas60}; componente ventanas: ${s.comps.win}; bloqueos visibles: ${bloqueos}`);
});

/* ======================= HU-006 ======================= */
test('PA-10', 'HU-006', 'CA01', 'Activar cada señal por separado', 'Pesos del índice: tiempo 30 %, ventanas 25 %, tecleo 25 %, cursor 20 %', 1, async (p) => {
  const val = async (o) => { await simular(p, o); return (await st(p)).indice; };
  const r = [await val({ cont: 120 }), await val({ vent: 12 }), await val({ del: 0.4 }), await val({ disp: 90 })];
  return check(r.join() === '30,25,25,20', `Índice con solo tiempo / ventanas / tecleo / cursor: ${r.join(' / ')}`);
});
test('PA-11', 'HU-006', 'CA02', 'Forzar índices bajo, medio y alto', 'La escala muestra Normal, Fatiga moderada y Sobrecarga crítica', 1, async (p) => {
  const lv = async (o) => { await simular(p, o); return txt(p, '#nivel-texto'); };
  const a = await lv({}), b = await lv({ cont: 120, vent: 12 }), c = await lv('alta');
  return check(a === 'Normal' && b === 'Fatiga moderada' && c === 'Sobrecarga crítica', `Etiquetas: ${a} / ${b} / ${c}`);
});
test('PA-12', 'HU-006', 'CA03', 'Esperar más de 60 s virtuales sin interactuar', 'El índice se recalcula localmente cada 60 s', 30, async (p) => {
  await sleep(1500); const n1 = parseInt((await txt(p, '#ultimo-calculo')).replace(/\D/g, ''), 10);
  await sleep(1000); const n2 = parseInt((await txt(p, '#ultimo-calculo')).replace(/\D/g, ''), 10);
  return check(n2 < n1, `"Último cálculo" pasó de hace ${n1} s a hace ${n2} s (se reinició al recalcular)`);
});

/* ======================= HU-007 ======================= */
test('PA-13', 'HU-007', 'CA01', 'Inspeccionar el control de sensibilidad', 'Es un slider con 3 niveles', 1, async (p) => {
  const a = await p.$eval('#sensibilidad', (e) => ({ t: e.type, min: e.min, max: e.max, step: e.step, v: e.getAttribute('aria-valuetext') }));
  return check(a.t === 'range' && a.min === '1' && a.max === '3' && a.step === '1', `type=${a.t}, min=${a.min}, max=${a.max}, step=${a.step}, valor por defecto=${a.v}`);
});
test('PA-14', 'HU-007', 'CA02', 'Cambiar la sensibilidad a Baja y a Alta', 'Los umbrales del algoritmo cambian automáticamente', 1, async (p) => {
  await setRange(p, 1); const baja = await txt(p, '#umbrales-texto');
  await setRange(p, 3); const alta = await txt(p, '#umbrales-texto');
  return check(baja.includes('> 16') && alta.includes('> 8') && baja !== alta, `Baja: "${baja}" | Alta: "${alta}"`);
});
test('PA-15', 'HU-007', 'CA03', 'Elegir Alta y recargar la página', 'La preferencia persiste localmente', 1, async (p) => {
  await setRange(p, 3); await sleep(100); await p.reload({ waitUntil: 'load' });
  const v = await p.$eval('#sensibilidad', (e) => e.value);
  return check(v === '3', `Valor tras recargar: ${v}`);
});

/* ======================= HU-009 ======================= */
test('PA-16', 'HU-009', 'CA01', 'Pulsar el botón Modo Zen de la barra superior', 'Se activa el Modo Zen desde un botón accesible', 1, async (p) => {
  const enBarra = await p.evaluate(() => !!document.querySelector('#barra-superior #btn-zen-barra'));
  await p.click('#btn-zen-barra');
  const on = await p.evaluate(() => document.body.classList.contains('zen'));
  const pr = await p.$eval('#btn-zen-barra', (e) => e.getAttribute('aria-pressed'));
  return check(enBarra && on && pr === 'true', `Botón en la barra: ${enBarra}; zen activo: ${on}; aria-pressed=${pr}`);
});
test('PA-17', 'HU-009', 'CA02', 'Pulsar Ctrl + Shift + Z', 'El atajo alterna el Modo Zen', 1, async (p) => {
  await combo(p, ['Control', 'Shift'], 'KeyZ'); const on = await p.evaluate(() => document.body.classList.contains('zen'));
  await combo(p, ['Control', 'Shift'], 'KeyZ'); const off = await p.evaluate(() => !document.body.classList.contains('zen'));
  return check(on && off, `Primera pulsación activa: ${on}; segunda desactiva: ${off}`);
});
test('PA-18', 'HU-009', 'CA03', 'Leer la duración de la transición CSS del Modo Zen', 'La transición es de 500 ms', 1, async (p) => {
  const v = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--t-zen').trim());
  const d = await cs(p, '.topbar', 'transition-duration');
  return check(v === '500ms' && d.includes('0.5s'), `--t-zen=${v}; transition-duration de la barra superior=${d}`);
});

/* ======================= HU-010 ======================= */
test('PA-19', 'HU-010', 'CA01 y CA02', 'Simular fatiga moderada (sin señal motriz)', 'Aparece un indicador flotante translúcido, sin sonido y no bloqueante', 30, async (p) => {
  await simular(p, { cont: 130, vent: 14 }); await sleep(200);
  const d = await p.evaluate(() => { const t = document.querySelector('.toast[data-tipo="zen"]'); if (!t) return null; const c = getComputedStyle(t); return { pos: getComputedStyle(document.getElementById('zona-sugerencias')).position, bg: c.backgroundColor, audio: window.__audio, bloqueo: document.querySelectorAll('.dialog-backdrop:not([hidden])').length }; });
  check(d, 'No apareció la sugerencia de Modo Zen');
  const alpha = parseFloat((d.bg.match(/,\s*([\d.]+)\)$/) || [0, 1])[1]);
  return check(d.pos === 'fixed' && alpha < 1 && d.audio === 0 && d.bloqueo === 0, `Posición=${d.pos}; opacidad del fondo=${alpha}; sonidos=${d.audio}; diálogos bloqueantes=${d.bloqueo}`);
});
test('PA-20', 'HU-010', 'CA03', 'No responder a la sugerencia durante 15 s virtuales', 'La sugerencia se desvanece sola a los 15 s', 30, async (p) => {
  await simular(p, { cont: 130, vent: 14 }); await sleep(150);
  const antes = await toastTipo(p, 'zen'); await sleep(1500);
  const despues = await toastTipo(p, 'zen');
  return check(antes && !despues, `Visible a los ~5 s virtuales: ${antes}; visible a los ~50 s virtuales: ${despues}`);
});

/* ======================= HU-011 ======================= */
test('PA-21', 'HU-011', 'CA01 y CA02', 'Activar Modo Zen con fatiga moderada y muestrear la atenuación', 'La luz baja entre 10 % y 30 % de forma gradual (>= 10 s)', 1, async (p) => {
  await simular(p, { cont: 120, vent: 12 }); await p.click('#btn-zen-barra'); await sleep(1000);
  const objetivo = await p.$eval('#atenuacion', (e) => parseFloat(e.style.opacity));
  const op1 = parseFloat(await cs(p, '#atenuacion', 'opacity'));
  const dur = await cs(p, '#atenuacion', 'transition-duration');
  return check(objetivo >= 0.1 && objetivo <= 0.3 && op1 < objetivo * 0.5 && dur === '10s', `Objetivo ${Math.round(objetivo * 100)} %; a 1 s lleva ${Math.round(op1 * 100)} %; duración de transición ${dur}`);
});
test('PA-22', 'HU-011', 'CA03', 'Pulsar Restaurar brillo estándar', 'El brillo vuelve a 0 % de atenuación con un clic', 1, async (p) => {
  await simular(p, { cont: 120, vent: 12 }); await p.click('#btn-zen-barra'); await sleep(2500);
  await p.click('#btn-restaurar-brillo'); await sleep(80);
  const op = parseFloat(await cs(p, '#atenuacion', 'opacity'));
  return check(op === 0, `Atenuación tras un clic: ${Math.round(op * 100)} %`);
});

/* ======================= HU-012 ======================= */
test('PA-23', 'HU-012', 'CA01 y CA02', 'Activar Modo Zen, medir la barra superior y pasar el cursor por el borde', 'Los elementos periféricos se repliegan y reaparecen suavemente con hover', 1, async (p) => {
  await p.click('#btn-zen-barra'); await p.mouse.move(683, 600); await sleep(900);
  const rep = await cs(p, '#barra-superior', 'transform'); const op = parseFloat(await cs(p, '#barra-superior', 'opacity'));
  const n = await txt(p, '#paneles-minimizados');
  await p.mouse.move(400, 25); await sleep(900);
  const hov = await cs(p, '#barra-superior', 'transform');
  return check(rep !== 'none' && op === 1 && hov === 'none', `En reposo: transform=${rep} (opacidad ${op}, sin transparencia); con hover: transform=${hov}; ${n}`);
});
test('PA-24', 'HU-012', 'CA03', 'Auditar contraste WCAG AA con axe-core en Modo Zen', 'Cero violaciones de contraste en lo visible', 1, async (p) => {
  await p.click('#btn-zen-barra'); await sleep(800);
  await p.evaluate(AXE_SRC);
  const r = await p.evaluate(() => axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } }));
  return check(r.violations.length === 0, `Violaciones de contraste: ${r.violations.length} (${r.violations.map((v) => v.nodes.length + ' nodos').join(', ') || 'ninguna'}); verificaciones aprobadas: ${r.passes.length}`);
});

/* ======================= HU-014 ======================= */
test('PA-25', 'HU-014', 'CA01 y CA02', 'Activar Vista de tarea única con texto escrito en el documento', 'El documento ocupa la pantalla y los demás paneles se minimizan sin cerrarse', 1, async (p) => {
  await p.click('#documento'); await p.keyboard.type(' texto conservado');
  await p.click('#btn-tarea-unica'); await sleep(100);
  const d = await p.evaluate(() => { const w = document.getElementById('espacio-trabajo'); const r = w.getBoundingClientRect(); return { pos: getComputedStyle(w).position, ancho: Math.round(r.width), iw: innerWidth, panel: getComputedStyle(document.getElementById('panel-estado')).display, existe: !!document.getElementById('panel-estado'), valor: document.getElementById('documento').value.includes('texto conservado') }; });
  return check(d.pos === 'fixed' && d.ancho >= d.iw - 2 && d.panel === 'none' && d.existe && d.valor, `Posición=${d.pos}; ancho=${d.ancho}/${d.iw}; panel de estado display=${d.panel} pero sigue en el DOM=${d.existe}; texto conservado=${d.valor}`);
});
test('PA-26', 'HU-014', 'CA03', 'Pulsar Alt + Shift + F dos veces', 'El atajo alterna entre vista única y normal', 1, async (p) => {
  await combo(p, ['Alt', 'Shift'], 'KeyF'); const a = await p.evaluate(() => document.body.classList.contains('single'));
  await combo(p, ['Alt', 'Shift'], 'KeyF'); const b = await p.evaluate(() => !document.body.classList.contains('single'));
  return check(a && b, `Primera pulsación activa: ${a}; segunda restaura: ${b}`);
});

/* ======================= HU-016 ======================= */
test('PA-27', 'HU-016', 'CA01', 'Activar Modo Zen y buscar el botón de salida', 'Hay un botón visible Salir de Modo Zen', 1, async (p) => {
  await p.click('#btn-zen-barra'); await sleep(200);
  const v = await vis(p, '#btn-salir-zen'); const t = await txt(p, '#btn-salir-zen');
  return check(v && t === 'Salir de Modo Zen', `Visible: ${v}; texto: "${t}"`);
});
test('PA-28', 'HU-016', 'CA02', 'Salir del Modo Zen con trabajo en curso', 'Restablece en menos de 300 ms sin reiniciar nada', 1, async (p) => {
  await p.click('#documento'); await p.keyboard.type(' trabajo en curso');
  await p.mouse.move(300, 300); await sleep(1200); const antes = await st(p);
  await p.click('#btn-zen-barra'); await sleep(300); await p.click('#btn-salir-zen'); await sleep(200);
  const s = await st(p); const v = await p.$eval('#documento', (e) => e.value.includes('trabajo en curso'));
  return check(s.lastZenExitMs !== null && s.lastZenExitMs < 300 && v && s.continuoMs >= antes.continuoMs, `Salida en ${s.lastZenExitMs} ms; texto conservado: ${v}; contador continuo ${Math.round(antes.continuoMs)} -> ${Math.round(s.continuoMs)} ms`);
});
test('PA-29', 'HU-016', 'CA03', 'Salir del Modo Zen', 'No aparece ningún diálogo de advertencia', 1, async (p) => {
  await p.click('#btn-zen-barra'); await sleep(200); await p.click('#btn-salir-zen'); await sleep(200);
  const n = await p.evaluate(() => document.querySelectorAll('.dialog-backdrop:not([hidden])').length);
  return check(n === 0 && p.__dialogs === 0, `Diálogos visibles: ${n}; alert/confirm del navegador: ${p.__dialogs}`);
});

/* ======================= HU-017 ======================= */
test('PA-30', 'HU-017', 'CA01 a CA03', 'Simular tensión motriz; ignorar y luego posponer', 'Globo translúcido con 2 opciones; no bloquea; posponer evita repetir 15 min', 30, async (p) => {
  await simular(p, 'alta'); await sleep(200);
  const d = await p.evaluate(() => { const t = document.querySelector('.toast[data-tipo="pausa"]'); return t ? { botones: [...t.querySelectorAll('button')].map((b) => b.textContent.trim()), bloqueo: document.querySelectorAll('.dialog-backdrop:not([hidden])').length } : null; });
  check(d, 'No apareció la sugerencia de micro-pausa');
  await p.click('.toast[data-tipo="pausa"] [data-acc="no"]'); await sleep(100);
  await simular(p, 'normal'); await simular(p, 'alta'); await sleep(200);
  const repite = await toastTipo(p, 'pausa');
  return check(d.botones.join('|') === 'Tomar pausa (60 s)|Posponer (15 min)' && d.bloqueo === 0 && !repite, `Opciones: ${d.botones.join(' / ')}; diálogos bloqueantes: ${d.bloqueo}; reaparece tras posponer: ${repite}`);
});

/* ======================= HU-018 ======================= */
test('PA-31', 'HU-018', 'CA01', 'Iniciar la pausa y muestrear la fase a los 2 s, 5 s y 8 s virtuales', 'Ritmo 4 s inhala, 2 s sostén, 6 s exhala', 2, async (p) => {
  await p.click('#btn-iniciar-pausa'); const f = [];
  await sleep(1000); f.push(await txt(p, '#breath-fase'));
  await sleep(1500); f.push(await txt(p, '#breath-fase'));
  await sleep(1500); f.push(await txt(p, '#breath-fase'));
  return check(f.join() === 'Inhala,Sostén,Exhala', `Fases observadas a ~2, 5 y 8 s virtuales: ${f.join(', ')}`);
});
test('PA-32', 'HU-018', 'CA02', 'Iniciar la pausa y revisar la cuenta regresiva y su finalización', 'Temporizador circular de 60 a 0 s', 20, async (p) => {
  await p.click('#btn-iniciar-pausa'); const ini = await txt(p, '#breath-tiempo');
  await sleep(1000); const mid = await txt(p, '#breath-tiempo');
  const off = await p.$eval('#breath-progress', (e) => parseFloat(e.style.strokeDashoffset));
  await sleep(2600);
  const fin = await p.evaluate(() => document.getElementById('dlg-pausa').hidden);
  const s = await p.evaluate(() => window.FocusSync.store().historial.pausas.slice(-1)[0]);
  return check(ini === '01:00' && /^00:(3|4)\d$/.test(mid) && off > 0 && fin && s && s.completa, `Inicio ${ini}; a ~20 s virtuales ${mid}; anillo desplazado ${off.toFixed(0)}; cerró sola: ${fin}; registrada como completa: ${s && s.completa}`);
});
test('PA-33', 'HU-018', 'CA03', 'Revisar indicadores textuales y la animación de la esfera', 'Texto de fase anunciado y escala de la esfera cambia suavemente', 2, async (p) => {
  await p.click('#btn-iniciar-pausa'); const aria = await p.$eval('#breath-fase', (e) => e.getAttribute('aria-live'));
  await sleep(300); const t1 = await cs(p, '#breath-sphere', 'transform'); await sleep(900); const t2 = await cs(p, '#breath-sphere', 'transform');
  return check(aria === 'polite' && t1 !== t2, `aria-live de la fase=${aria}; transformación 1=${t1}; transformación 2=${t2}`);
});

/* ======================= HU-020 ======================= */
test('PA-34', 'HU-020', 'CA01 a CA03', 'Dejar el cursor en una posición, pausar, saltar y pulsar Volver a mi tarea', 'Se restaura la posición y se resalta suavemente el espacio de trabajo', 1, async (p) => {
  await p.evaluate(() => { const d = document.getElementById('documento'); d.focus(); d.setSelectionRange(10, 10); });
  await p.click('#btn-iniciar-pausa'); await sleep(200);
  const m = await st(p); await p.click('#btn-saltar'); await sleep(100);
  const botonVisible = await vis(p, '#btn-volver-tarea');
  await p.evaluate(() => { document.getElementById('documento').setSelectionRange(0, 0); document.activeElement.blur(); });
  await p.click('#btn-volver-tarea'); await sleep(100);
  const r = await p.evaluate(() => ({ foco: document.activeElement.id, caret: document.getElementById('documento').selectionStart, res: document.getElementById('espacio-trabajo').classList.contains('resaltado') }));
  return check(m.marcador && m.marcador.caret === 10 && botonVisible && r.foco === 'documento' && r.caret === 10 && r.res, `Marcador guardado: caret ${m.marcador && m.marcador.caret}; botón visible: ${botonVisible}; tras volver: foco=${r.foco}, caret=${r.caret}, resaltado=${r.res}`);
});

/* ======================= HU-021 ======================= */
test('PA-35', 'HU-021', 'CA01 y CA02', 'Iniciar la pausa y pulsar Saltar ejercicio', 'Cierre inmediato (< 200 ms) y sin penalización', 1, async (p) => {
  await p.click('#btn-iniciar-pausa'); await sleep(300);
  const visible = await vis(p, '#btn-saltar'); await p.click('#btn-saltar'); await sleep(100);
  const s = await st(p); const cerrado = await p.evaluate(() => document.getElementById('dlg-pausa').hidden);
  const msg = await txt(p, '#estado-pausa');
  return check(visible && cerrado && s.lastSkipMs < 200 && !/mal|fall|culp/i.test(msg), `Botón visible: ${visible}; cierre en ${s.lastSkipMs} ms; mensaje: "${msg}"`);
});
test('PA-36', 'HU-021', 'CA03', 'Saltar la pausa y volver a provocar sobrecarga', 'No hay nuevas alertas durante los siguientes 20 min', 30, async (p) => {
  await p.click('#btn-iniciar-pausa'); await sleep(200); await p.click('#btn-saltar'); await sleep(100);
  await simular(p, 'alta'); await sleep(300);
  const s = await st(p); const hay = await p.evaluate(() => !!document.querySelector('.toast[data-tipo="pausa"], .toast[data-tipo="zen"]'));
  return check(s.quietActivo && !hay, `Silencio activo: ${s.quietActivo}; sugerencias mostradas: ${hay}`);
});

/* ======================= HU-024 ======================= */
test('PA-37', 'HU-024', 'CA01 a CA03', 'Saltar la pausa y observar el mensaje de refuerzo', 'Frase constructiva sin juicios que se cierra a los 4 s', 1, async (p) => {
  await p.click('#btn-iniciar-pausa'); await sleep(200); await p.click('#btn-saltar'); await sleep(150);
  const t = await p.evaluate(() => { const e = document.querySelector('.toast[data-tipo="empatico"]'); return e ? e.textContent.trim() : null; });
  check(t, 'No apareció el mensaje');
  await sleep(2700); const aun = await toastTipo(p, 'empatico'); await sleep(2800); const fin = await toastTipo(p, 'empatico');
  return check(!/(perdiste|mejor que|deber[ií]as|culpa)/i.test(t) && aun && !fin, `Mensaje: "${t}"; visible a los ~3 s: ${aun}; visible a los ~6 s: ${fin}`);
});

/* ======================= HU-026 ======================= */
const llenarHitos = async (p, tipo) => { await p.type('#h-nombre', 'Informe de laboratorio 5'); await p.select('#h-tipo', tipo); await p.click('#form-hitos button[type="submit"]'); await sleep(100); };
test('PA-38', 'HU-026', 'CA01', 'Fraccionar un entregable', 'Se generan hasta 5 micro-hitos', 1, async (p) => {
  await llenarHitos(p, 'informe'); const n = await p.$$eval('#lista-hitos li', (l) => l.length);
  return check(n >= 3 && n <= 5, `Micro-hitos generados: ${n}`);
});
test('PA-39', 'HU-026', 'CA02', 'Fraccionar con los 4 tipos de trabajo', 'Todos los micro-hitos duran menos de 45 min', 1, async (p) => {
  const out = [];
  for (const tipo of ['informe', 'programacion', 'estudio', 'proyecto']) {
    await p.select('#h-tipo', tipo); await p.$eval('#h-nombre', (e) => { e.value = 'Entrega de prueba'; });
    await p.click('#form-hitos button[type="submit"]'); await sleep(60);
    out.push(await p.$$eval('#lista-hitos input[type="number"]', (l) => Math.max(...l.map((x) => Number(x.value)))));
  }
  return check(out.every((m) => m < 45), `Duración máxima por tipo (informe, programación, estudio, proyecto): ${out.join(', ')} min`);
});
test('PA-40', 'HU-026', 'CA03', 'Marcar 2 de 5 micro-hitos', 'La barra de progreso refleja el avance acumulado', 1, async (p) => {
  await llenarHitos(p, 'informe'); await p.click('#hito-c-0'); await p.click('#hito-c-1'); await sleep(80);
  const t = await txt(p, '#hitos-progreso-texto'); const v = await p.$eval('#meter-hitos', (e) => e.getAttribute('aria-valuenow'));
  return check(t === '2 de 5 completados' && v === '40', `Texto: "${t}"; aria-valuenow=${v}`);
});
test('PA-41', 'HU-026', 'Validación', 'Enviar el formulario de micro-hitos vacío', 'Se muestra un error asociado al campo', 1, async (p) => {
  await p.click('#form-hitos button[type="submit"]'); await sleep(60);
  const d = await p.evaluate(() => ({ err: !document.getElementById('h-nombre-err').hidden, inv: document.getElementById('h-nombre').getAttribute('aria-invalid'), msg: document.getElementById('h-nombre-err').textContent }));
  return check(d.err && d.inv === 'true', `Error visible: ${d.err}; aria-invalid=${d.inv}; mensaje: "${d.msg}"`);
});

/* ======================= HU-028 ======================= */
test('PA-42', 'HU-028', 'CA01', 'Ingresar metas de 30 y 100 minutos', 'La meta se ajusta al rango de 45 a 90 min', 1, async (p) => {
  const set = async (v) => { await p.$eval('#meta-min', (e, x) => { e.value = x; e.dispatchEvent(new Event('change', { bubbles: true })); }, v); return p.$eval('#meta-min', (e) => e.value); };
  const a = await set('30'), b = await set('100'), c = await set('60');
  return check(a === '45' && b === '90' && c === '60', `30 -> ${a}; 100 -> ${b}; 60 -> ${c}`);
});
test('PA-43', 'HU-028', 'CA02 y CA03', 'Iniciar y superar la meta', 'Aviso visual suave y conteo en positivo sin bloquear', 1, async (p) => {
  await p.click('#btn-timer'); await sleep(1200); const t1 = await txt(p, '#timer-display');
  await p.evaluate(() => window.FocusSync.ajustarTimer(45 * 60000)); await sleep(1200);
  const d = await p.evaluate(() => ({ t: document.getElementById('timer-display').textContent.trim(), pos: document.getElementById('timer-display').classList.contains('positivo'), chip: !!document.getElementById('chip-meta'), bloqueo: document.querySelectorAll('.dialog-backdrop:not([hidden])').length }));
  await p.click('#documento'); await p.keyboard.type('sigo escribiendo'); const sigue = await p.$eval('#documento', (e) => e.value.includes('sigo escribiendo'));
  return check(/^00:0[1-3]$/.test(t1) && d.t.startsWith('+') && d.pos && d.chip && d.bloqueo === 0 && sigue, `Antes de la meta: ${t1}; después: ${d.t}; aviso en barra: ${d.chip}; bloqueos: ${d.bloqueo}; se puede seguir trabajando: ${sigue}`);
});

/* ======================= HU-031 ======================= */
test('PA-44', 'HU-031', 'CA01', 'Pulsar Ctrl + J', 'Se abre el bloc con foco listo para escribir', 1, async (p) => {
  await combo(p, ['Control'], 'KeyJ'); await sleep(100);
  const d = await p.evaluate(() => ({ vis: !document.getElementById('dlg-notas').hidden, foco: document.activeElement.id }));
  return check(d.vis && d.foco === 'notas-texto', `Bloc visible: ${d.vis}; foco en: ${d.foco}`);
});
test('PA-45', 'HU-031', 'CA02', 'Escribir una nota y esperar', 'Se guarda sola, localmente y sin pedir título', 1, async (p) => {
  await combo(p, ['Control'], 'KeyJ'); await p.keyboard.type('comprar cargador', { delay: 3 }); await sleep(600);
  const guardado = await p.evaluate(() => (localStorage.getItem('focussync:v1') || '').includes('comprar cargador'));
  const titulo = await p.evaluate(() => !!document.querySelector('#dlg-notas input[type="text"]'));
  return check(guardado && !titulo, `Guardada en localStorage: ${guardado}; campo de título: ${titulo}`);
});
test('PA-46', 'HU-031', 'CA03', 'Pulsar Escape con el bloc abierto', 'Cierre instantáneo y retorno del foco', 1, async (p) => {
  await p.focus('#btn-abrir-notas'); await combo(p, ['Control'], 'KeyJ'); await sleep(80);
  const d = await p.evaluate(() => { const t0 = performance.now(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return { ms: performance.now() - t0, oculto: document.getElementById('dlg-notas').hidden, foco: document.activeElement.id }; });
  return check(d.oculto && d.ms < 100 && d.foco === 'btn-abrir-notas', `Cerrado: ${d.oculto} en ${d.ms.toFixed(1)} ms; foco devuelto a: ${d.foco}`);
});

/* ======================= HU-035 ======================= */
test('PA-47', 'HU-035', 'CA01', 'Cargar datos de ejemplo', 'Se dibuja un gráfico de barras estudio vs pausas', 1, async (p) => {
  await p.click('#btn-datos-ejemplo'); await sleep(100);
  const d = await p.evaluate(() => ({ rects: document.querySelectorAll('#grafico-balance svg rect').length, al: document.getElementById('grafico-balance').getAttribute('aria-label') }));
  return check(d.rects >= 14 && /Estudio total/.test(d.al), `Barras: ${d.rects}; aria-label: "${d.al}"`);
});
test('PA-48', 'HU-035', 'CA02', 'Cambiar el filtro entre Día, Semana y Mes', 'El gráfico cambia de periodo', 1, async (p) => {
  await p.click('#btn-datos-ejemplo'); const n = {};
  for (const v of ['dia', 'semana', 'mes']) { await p.click(`input[name="periodo"][value="${v}"]`); await sleep(60); n[v] = await p.$$eval('#grafico-balance svg rect', (l) => l.length); }
  return check(n.dia === 2 && n.semana === 14 && n.mes === 60, `Barras por periodo: día ${n.dia}, semana ${n.semana}, mes ${n.mes}`);
});
test('PA-49', 'HU-035', 'CA03', 'Revisar el indicador de equilibrio con datos de ejemplo', 'Muestra la proporción de pausas frente al valor sugerido', 1, async (p) => {
  await p.click('#btn-datos-ejemplo'); const t = await txt(p, '#balance-indicador');
  return check(/%/.test(t) && /sugerido/.test(t) && /(Equilibrio saludable|Por debajo de lo sugerido)/.test(t), `Indicador: "${t}"`);
});

/* ======================= HU-036 ======================= */
test('PA-50', 'HU-036', 'CA01', 'Pulsar Cerrar jornada', 'Aparecen 5 estados anímicos', 1, async (p) => {
  await p.click('#btn-cerrar-jornada'); const n = await p.$$eval('.mood', (l) => l.length);
  return check(n === 5, `Estados disponibles: ${n}`);
});
test('PA-51', 'HU-036', 'CA02', 'Registrar con un clic y verificar Omitir', 'Un clic registra y la opción Omitir está visible', 1, async (p) => {
  await p.click('#btn-cerrar-jornada'); const omitir = await vis(p, '#btn-omitir-animo');
  await p.click('.mood[data-mood="4"]'); await sleep(80);
  const d = await p.evaluate(() => ({ n: window.FocusSync.store().historial.animos.length, oculto: document.getElementById('panel-animo').hidden }));
  return check(omitir && d.n === 1 && d.oculto, `Omitir visible: ${omitir}; registros: ${d.n}; panel cerrado tras un clic: ${d.oculto}`);
});
test('PA-52', 'HU-036', 'CA03', 'Estudiar unos segundos y registrar ánimo', 'El registro queda vinculado a las horas trabajadas', 30, async (p) => {
  await p.mouse.move(300, 300); await p.mouse.move(340, 330); await sleep(1800);
  await p.click('#btn-cerrar-jornada'); await p.click('.mood[data-mood="3"]'); await sleep(80);
  const d = await p.evaluate(() => ({ a: window.FocusSync.store().historial.animos[0], li: document.querySelector('#historial-animo li').textContent }));
  return check(d.a && typeof d.a.estudioMin === 'number' && d.a.estudioMin > 0 && /trabajados/.test(d.li), `estudioMin=${d.a && d.a.estudioMin.toFixed(2)}; historial: "${d.li}"`);
});

/* ======================= HU-037 ======================= */
test('PA-53', 'HU-037', 'CA01 a CA03', 'Completar una pausa y saltar otra', 'Contador semanal de ejercicios, minutos en calma y mensaje positivo', 30, async (p) => {
  await p.click('#btn-iniciar-pausa'); await sleep(2400);
  const compl = await txt(p, '#res-ejercicios');
  await p.click('#btn-iniciar-pausa'); await sleep(200); await p.click('#btn-saltar'); await sleep(100);
  const comp2 = await txt(p, '#res-ejercicios'); const min = await txt(p, '#res-minutos'); const msg = await txt(p, '#res-mensaje');
  return check(compl === '1' && comp2 === '1' && parseFloat(min.replace(',', '.')) >= 1 && /¡Bien!/.test(msg) && !/(fallaste|mal)/i.test(msg), `Tras completar: ${compl}; tras saltar otra: ${comp2}; minutos en calma: ${min}; mensaje: "${msg}"`);
});

/* ======================= HU-043 ======================= */
test('PA-54', 'HU-043', 'CA01 a CA03', 'Usar todas las funciones y contar peticiones de red; intentar enviar datos', 'Cero peticiones; el navegador bloquea cualquier envío; indicador visible', 30, async (p) => {
  await p.click('#documento'); await p.keyboard.type('prueba de red'); await erratico(p, 300); await simular(p, 'alta');
  await p.click('#btn-iniciar-pausa'); await sleep(300); await p.click('#btn-saltar'); await sleep(200);
  const csp = await p.$eval('meta[http-equiv="Content-Security-Policy"]', (e) => e.content);
  const bloqueo = await p.evaluate(() => new Promise((res) => { document.addEventListener('securitypolicyviolation', () => res(true), { once: true }); const i = new Image(); i.src = 'https://ejemplo.invalid/p.png?x=1'; setTimeout(() => res(false), 1500); }));
  const s = await st(p); const chip = await txt(p, '#chip-privacidad');
  return check(p.__reqs.length === 0 && s.redSolicitudes === 0 && csp.includes("connect-src 'none'") && bloqueo && /100%/.test(chip), `Peticiones tras la carga: ${p.__reqs.length}; contador interno: ${s.redSolicitudes}; CSP connect-src 'none'; envío externo bloqueado por el navegador: ${bloqueo}; indicador: "${chip}"`);
});

/* ======================= HU-044 ======================= */
test('PA-55', 'HU-044', 'CA01 y CA02', 'Auditar los oyentes de teclado registrados', 'No existen oyentes keypress/keyup ni captura de valores de tecla', 1, async (p) => {
  const kp = await oyentes(p, 'keypress'), ku = await oyentes(p, 'keyup'), kd = await oyentes(p, 'keydown'), inp = await oyentes(p, 'input');
  await p.click('#documento'); await p.keyboard.type('xyz'); const s = await p.evaluate(() => JSON.stringify(window.FocusSync.estado()) + JSON.stringify(window.FocusSync.store()));
  return check(kp === 0 && ku === 0 && kd === 2 && inp === 1 && !/xyz/.test(s), `Oyentes en document: keypress=${kp}, keyup=${ku}, keydown=${kd} (atajos y trampa de foco), input=${inp}; "xyz" presente en estado: ${/xyz/.test(s)}`);
});
test('PA-56', 'HU-044', 'CA03', 'Buscar el manifiesto de privacidad en la interfaz', 'Se muestra de forma transparente y verificable', 1, async (p) => {
  const t = await p.evaluate(() => document.getElementById('privacidad').textContent);
  await p.click('#privacidad summary'); await sleep(80);
  const insp = await txt(p, '#inspector-datos');
  return check(/No guardamos lo que escribes/.test(t) && /teclas_o_caracteres/.test(insp), `Manifiesto presente: ${/No guardamos lo que escribes/.test(t)}; inspector muestra "teclas_o_caracteres: nunca se registran": ${/nunca se registran/.test(insp)}`);
});

/* ======================= HU-045 ======================= */
test('PA-57', 'HU-045', 'CA01', 'Buscar la opción de borrado', 'Existe el botón Borrar todos mis datos de estudio', 1, async (p) => {
  const t = await txt(p, '#btn-borrar'); const v = await vis(p, '#btn-borrar');
  return check(v && t === 'Borrar todos mis datos de estudio', `Visible: ${v}; texto: "${t}"`);
});
test('PA-58', 'HU-045', 'CA02', 'Pulsar borrar y cancelar', 'Aparece una confirmación y cancelar no borra nada', 1, async (p) => {
  await p.click('#btn-datos-ejemplo'); await sleep(100);
  await p.click('#btn-borrar'); await sleep(80);
  const rol = await p.$eval('#dlg-borrar [role="alertdialog"]', (e) => e.getAttribute('role')); const v = await vis(p, '#dlg-borrar');
  await p.click('#btn-borrar-cancel'); await sleep(80);
  const sigue = await p.evaluate(() => !!localStorage.getItem('focussync:v1'));
  return check(rol === 'alertdialog' && v && sigue, `Rol=${rol}; confirmación visible: ${v}; datos intactos tras cancelar: ${sigue}`);
});
test('PA-59', 'HU-045', 'CA03', 'Confirmar el borrado con datos, ánimo y notas guardados', 'Purga total e instantánea del almacenamiento local', 1, async (p) => {
  await p.click('#btn-datos-ejemplo'); await p.click('#btn-cerrar-jornada'); await p.click('.mood[data-mood="4"]');
  await combo(p, ['Control'], 'KeyJ'); await p.keyboard.type('nota a borrar'); await sleep(500); await p.keyboard.press('Escape');
  const antes = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('focussync')).length);
  await p.click('#btn-borrar'); await p.click('#btn-borrar-ok'); await sleep(100);
  const d = await p.evaluate(() => ({ claves: Object.keys(localStorage).filter((k) => k.startsWith('focussync')).length, ms: window.FocusSync.estado().lastPurgeMs, graf: document.getElementById('balance-indicador').textContent, msg: document.getElementById('borrar-estado').textContent }));
  return check(antes === 1 && d.claves === 0 && d.ms < 100 && /Aún no hay datos/.test(d.graf), `Claves antes: ${antes}; después: ${d.claves}; purga en ${d.ms} ms; gráfico: "${d.graf}"`);
});

/* ======================= HU-046 ======================= */
test('PA-60', 'HU-046', 'CA01', 'Inspeccionar el interruptor de monitoreo', 'Es un switch accesible que alterna el monitoreo', 1, async (p) => {
  const a = await p.$eval('#sw-monitoreo', (e) => [e.getAttribute('role'), e.getAttribute('aria-checked')].join('/'));
  await p.click('#sw-monitoreo'); const b = await p.$eval('#sw-monitoreo', (e) => e.getAttribute('aria-checked'));
  return check(a === 'switch/true' && b === 'false', `Inicial: ${a}; tras pulsar: aria-checked=${b}`);
});
test('PA-61', 'HU-046', 'CA02', 'Pausar el monitoreo y luego escribir y mover el cursor', 'Se retiran los oyentes y no se registra nada', 30, async (p) => {
  const antes = await oyentes(p, 'input') + await oyentes(p, 'mousemove');
  await p.click('#sw-monitoreo'); await sleep(100);
  const despues = await oyentes(p, 'input') + await oyentes(p, 'mousemove');
  await p.click('#documento'); await p.keyboard.type('abcdefghijklmnopqrstuvwxyz', { delay: 2 });
  for (let i = 0; i < 20; i++) await p.keyboard.press('Backspace');
  await erratico(p, 400); const s = await st(p);
  return check(antes === 2 && despues === 0 && s.listeners === 0 && s.borrado === 0 && s.continuoMs === 0, `Oyentes input+mousemove: ${antes} -> ${despues}; listeners internos=${s.listeners}; borrado=${s.borrado}; tiempo continuo=${s.continuoMs} ms`);
});
test('PA-62', 'HU-046', 'CA03', 'Alternar y leer estado y color', 'Activo en verde, En pausa en gris, con texto', 1, async (p) => {
  const a = [await txt(p, '#tag-monitoreo'), await cs(p, '#tag-monitoreo', 'color')];
  await p.click('#sw-monitoreo'); const b = [await txt(p, '#tag-monitoreo'), await cs(p, '#tag-monitoreo', 'color')];
  return check(a[0] === 'Activo' && a[1] === 'rgb(47, 107, 63)' && b[0] === 'En pausa' && b[1] === 'rgb(95, 93, 73)', `Activo: ${a.join(' ')}; En pausa: ${b.join(' ')}`);
});

/* ======================= HU-047 ======================= */
test('PA-63', 'HU-047', 'CA01', 'Elegir 30 minutos y activar el Modo Examen', 'La duración es configurable y se informa en pantalla', 1, async (p) => {
  const opts = await p.$$eval('#examen-min option', (l) => l.map((o) => o.value).join(','));
  await p.select('#examen-min', '30'); await p.click('#btn-examen'); await sleep(1300);
  const e = await txt(p, '#examen-estado'); const c = await txt(p, '#chip-examen');
  return check(opts === '30,60,90,120' && /30 minutos/.test(e) && /29:5\d|30:00/.test(c), `Opciones: ${opts}; estado: "${e}"; chip: "${c}"`);
});
test('PA-64', 'HU-047', 'CA02', 'Con el Modo Examen activo, provocar sobrecarga y tensión motriz', 'No aparece ninguna sugerencia ni modal', 30, async (p) => {
  await simular(p, { cont: 130, vent: 14 }); await sleep(120);
  const previo = await toastTipo(p, 'zen');
  await p.click('#btn-examen'); await sleep(100);
  const trasActivar = await p.evaluate(() => document.querySelectorAll('.toast').length);
  await simular(p, 'alta'); await sleep(400);
  const hay = await p.evaluate(() => document.querySelectorAll('.toast').length);
  return check(previo && trasActivar === 0 && hay === 0, `Sugerencia previa: ${previo}; toasts tras activar: ${trasActivar}; toasts con sobrecarga durante el examen: ${hay}`);
});
test('PA-65', 'HU-047', 'CA03', 'Activar examen de 30 min con reloj acelerado', 'Se desactiva solo al expirar el tiempo', 600, async (p) => {
  await p.select('#examen-min', '30'); await p.click('#btn-examen'); await sleep(3800);
  const d = await p.evaluate(() => ({ chip: document.getElementById('chip-examen').hidden, msg: document.getElementById('examen-estado').textContent, activo: window.FocusSync.estado().examenActivo }));
  return check(d.chip && !d.activo && /automáticamente/.test(d.msg), `Chip oculto: ${d.chip}; activo: ${d.activo}; mensaje: "${d.msg}"`);
});

/* ======================= HU-048 ======================= */
test('PA-66', 'HU-048', 'CA01', 'Buscar botones, enlaces o secciones de supervisión docente', 'No existe ningún panel ni reporte de supervisión', 1, async (p) => {
  const r = await p.evaluate(() => {
    const ctl = [...document.querySelectorAll('button, a, [role="tab"], [role="menuitem"], nav li')].map((e) => e.textContent.trim()).filter((t) => /(docente|tutor|alumnos?|supervisi[oó]n|reporte)/i.test(t));
    const ids = [...document.querySelectorAll('[id],[class]')].filter((e) => /(docente|tutor|supervis)/i.test(e.id + ' ' + e.className)).map((e) => e.id || e.className);
    const fila = [...document.querySelectorAll('tbody tr')].map((tr) => tr.textContent.replace(/\s+/g, ' ').trim());
    return { ctl, ids, fila };
  });
  return check(r.ctl.length === 0 && r.ids.length === 0 && r.fila.some((f) => /Docentes y tutores.*Ninguno/.test(f)), `Controles de supervisión: ${r.ctl.length}; elementos con id/clase de supervisión: ${r.ids.length}; tabla de acceso: ${r.fila.join(' | ')}`);
});
test('PA-67', 'HU-048', 'CA02', 'Buscar el manifiesto ético', 'Se declara el respeto a la autonomía estudiantil', 1, async (p) => {
  const t = await p.evaluate(() => document.getElementById('privacidad').textContent);
  return check(/nunca como vigilancia/.test(t) && /Compromiso ético/.test(t), 'El manifiesto indica que docentes y tutores pueden recomendarlo "como autocuidado, nunca como vigilancia"');
});
test('PA-68', 'HU-048', 'CA03', 'Usar la demo y verificar transmisión a terceros', 'Cero transmisión de reportes', 30, async (p) => {
  await simular(p, 'alta'); await p.click('#btn-iniciar-pausa'); await sleep(300); await p.click('#btn-saltar'); await sleep(200);
  const s = await st(p);
  return check(p.__reqs.length === 0 && s.redSolicitudes === 0, `Peticiones de red tras la carga: ${p.__reqs.length}; contador interno: ${s.redSolicitudes}`);
});

/* ======================= HU-049 ======================= */
test('PA-69', 'HU-049', 'CA01', 'Ingresar frecuencias de 30 y 200 minutos', 'El selector se limita al rango de 45 a 150', 1, async (p) => {
  const set = async (v) => { await p.$eval('#frecuencia', (e, x) => { e.value = x; e.dispatchEvent(new Event('change', { bubbles: true })); }, v); return p.$eval('#frecuencia', (e) => e.value); };
  const a = await set('30'), b = await set('200'), c = await set('90');
  return check(a === '45' && b === '150' && c === '90', `30 -> ${a}; 200 -> ${b}; 90 -> ${c}`);
});
test('PA-70', 'HU-049', 'CA02', 'Elegir 130 y luego 120 minutos', 'Aparece el consejo pedagógico solo si supera 120 min', 1, async (p) => {
  const set = async (v) => { await p.$eval('#frecuencia', (e, x) => { e.value = x; e.dispatchEvent(new Event('input', { bubbles: true })); }, v); return vis(p, '#frecuencia-consejo'); };
  const a = await set('130'), b = await set('120');
  return check(a === true && b === false, `Consejo visible con 130: ${a}; con 120: ${b}`);
});
test('PA-71', 'HU-049', 'CA03', 'Simular 60 min continuos con frecuencia base de 60 y de 120', 'El peso del tiempo en el índice se modula por la frecuencia', 1, async (p) => {
  const idx = async (f) => { await p.$eval('#frecuencia', (e, x) => { e.value = x; e.dispatchEvent(new Event('change', { bubbles: true })); }, f); await simular(p, { cont: 60 }); return (await st(p)).indice; };
  const a = await idx('60'), b = await idx('120');
  return check(a === 30 && b === 15, `Índice con 60 min continuos: frecuencia 60 -> ${a}; frecuencia 120 -> ${b}`);
});

/* ======================= Transversales: accesibilidad y responsive ======================= */
test('PA-72', 'Transversal', 'Accesibilidad', 'Auditar la página con axe-core (WCAG 2.1 A y AA)', 'Cero violaciones en el estado inicial', 1, async (p) => {
  await p.evaluate(AXE_SRC);
  const r = await p.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
  return check(r.violations.length === 0, `Violaciones: ${r.violations.length} ${r.violations.map((v) => v.id + ' x' + v.nodes.length).join(', ')}; reglas aprobadas: ${r.passes.length}`);
});
test('PA-73', 'Transversal', 'Accesibilidad', 'Auditar con axe-core con el diálogo de respiración abierto', 'Cero violaciones en el diálogo modal', 1, async (p) => {
  await p.click('#btn-iniciar-pausa'); await sleep(200); await p.evaluate(AXE_SRC);
  const r = await p.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }));
  return check(r.violations.length === 0, `Violaciones: ${r.violations.length} ${r.violations.map((v) => v.id + ' x' + v.nodes.length).join(', ')}`);
});
test('PA-74', 'Transversal', 'Teclado', 'Pulsar Tab desde el inicio y revisar el foco', 'El primer foco es el enlace para saltar al contenido, con indicador visible', 1, async (p) => {
  await p.keyboard.press('Tab');
  const d = await p.evaluate(() => { const e = document.activeElement; const c = getComputedStyle(e); return { txt: e.textContent.trim(), outline: c.outlineStyle + ' ' + c.outlineWidth }; });
  return check(/Saltar al contenido/.test(d.txt) && /solid 3px/.test(d.outline), `Primer foco: "${d.txt}"; contorno: ${d.outline}`);
});
test('PA-75', 'Transversal', 'Accesibilidad', 'Verificar etiquetas de formularios y textos alternativos', 'Todo campo tiene etiqueta y todo SVG informativo tiene nombre', 1, async (p) => {
  const d = await p.evaluate(() => { const campos = [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')]; const sinNombre = campos.filter((c) => !(c.labels && c.labels.length) && !c.getAttribute('aria-label') && !c.getAttribute('aria-labelledby')).map((c) => c.id); const svgs = [...document.querySelectorAll('svg[role="img"]')]; const svgSin = svgs.filter((s) => !(s.getAttribute('aria-label') || s.querySelector('title'))).length; return { campos: campos.length, sinNombre, svgs: svgs.length, svgSin }; });
  return check(d.sinNombre.length === 0 && d.svgSin === 0, `Campos revisados: ${d.campos}, sin etiqueta: ${d.sinNombre.length}; SVG informativos: ${d.svgs}, sin nombre: ${d.svgSin}`);
});
test('PA-76', 'Transversal', 'Responsive', 'Revisar el desbordamiento horizontal en 4 anchos de pantalla', 'No aparece scroll horizontal en escritorio, laptop, tablet y móvil', 1, async (p) => {
  const out = [];
  for (const w of [1366, 1024, 768, 390]) { await p.setViewport({ width: w, height: 900 }); await sleep(120); out.push(`${w}px: ${await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)}`); }
  return check(out.every((o) => parseInt(o.split(': ')[1], 10) <= 1), `Exceso de ancho: ${out.join(' | ')}`);
});
test('PA-77', 'Transversal', 'Responsive', 'En 390 px abrir el menú de navegación', 'El menú se colapsa y se abre con un botón accesible', 1, async (p) => {
  await p.setViewport({ width: 390, height: 844 }); await sleep(120);
  const oculto = !(await vis(p, '#menu-principal')); const btn = await vis(p, '#menu-toggle');
  await p.click('#menu-toggle'); await sleep(80); const abierto = await vis(p, '#menu-principal'); const ex = await p.$eval('#menu-toggle', (e) => e.getAttribute('aria-expanded'));
  return check(oculto && btn && abierto && ex === 'true', `Menú oculto al inicio: ${oculto}; botón visible: ${btn}; abierto tras pulsar: ${abierto}; aria-expanded=${ex}`);
});
test('PA-78', 'Transversal', 'Accesibilidad', 'Emular preferencia de movimiento reducido', 'Las animaciones y transiciones se reducen al mínimo', 1, async (p) => {
  const d = await cs(p, '.btn--primary', 'transition-duration');
  return check(parseFloat(d) < 0.05, `transition-duration de botones con movimiento reducido: ${d}`);
}, { reduced: true });

/* ======================= Ejecución ======================= */
(async () => {
  browser = await puppeteer.launch({ headless: 'new', executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  for (const t of tests) {
    const opts = t.fn.length === 0 ? {} : {};
    const extra = t.id === 'PA-78' ? { reduced: true } : {};
    let h; const t0 = Date.now();
    try {
      h = await abrir(t.ts, extra);
      const obtenido = await t.fn(h.page);
      resultados.push({ ...t, fn: undefined, obtenido, estado: 'Cumple', ms: Date.now() - t0 });
      console.log(`OK   ${t.id} ${t.hu} ${t.criterio}`);
    } catch (e) {
      resultados.push({ ...t, fn: undefined, obtenido: e.obtenido || ('Error: ' + e.message), estado: 'No cumple', ms: Date.now() - t0 });
      console.log(`FAIL ${t.id} ${t.hu} ${t.criterio} -> ${e.obtenido || e.message}`);
    } finally { if (h) await h.close(); }
  }
  await browser.close();
  const outDir = path.join(__dirname, 'results'); fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'resultados.json'), JSON.stringify({ url: BASE, fecha: new Date().toISOString(), resultados }, null, 2));
  const ok = resultados.filter((r) => r.estado === 'Cumple').length;
  const md = ['# Resultados de pruebas de aceptación', '', `URL probada: ${BASE}`, `Fecha: ${new Date().toISOString()}`, `Resultado global: ${ok} de ${resultados.length} pruebas cumplen`, '',
    '| ID prueba | HU | Criterio / escenario | Acción de prueba | Resultado esperado | Resultado obtenido | Estado |', '|---|---|---|---|---|---|---|',
    ...resultados.map((r) => `| ${r.id} | ${r.hu} | ${r.criterio} | ${r.accion} | ${r.esperado} | ${String(r.obtenido).replace(/\|/g, '/')} | ${r.estado} |`)].join('\n');
  fs.writeFileSync(path.join(outDir, 'resultados.md'), md);
  console.log(`\n${ok}/${resultados.length} pruebas cumplen`);
  process.exit(ok === resultados.length ? 0 : 1);
})();
