/* =========================================================
   FocusSync · main.js
   Demo académica de 30 Historias de Usuario core.
   Principios:
   - Todo se procesa en memoria del navegador (HU-043).
   - Nunca se lee ni guarda el valor de las teclas (HU-044).
   - Parámetro ?timescale=N acelera el reloj virtual N veces
     (solo para pruebas; por defecto es 1 = tiempos reales).
   ========================================================= */
(() => {
  'use strict';

  /* ---------- Utilidades de tiempo ---------- */
  const TS = Math.max(1, Number(new URLSearchParams(location.search).get('timescale')) || 1);
  const vnow = () => performance.now() * TS;          // milisegundos virtuales
  const rms = (ms) => ms / TS;                         // virtual -> real (para setTimeout)
  const $ = (id) => document.getElementById(id);
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
  const pad = (n) => String(n).padStart(2, '0');
  const fmtHMS = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`; };
  const fmtMS = (ms) => { const s = Math.floor(ms / 1000); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };
  const hoyKey = () => new Date().toLocaleDateString('en-CA');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  document.documentElement.style.setProperty('--t-zen', `${500 / TS}ms`);
  document.documentElement.style.setProperty('--t-dim', `${10 / TS}s`);

  /* ---------- Almacenamiento local (solo agregados, nunca texto tecleado) ---------- */
  const STORE_KEY = 'focussync:v1';
  const defaults = () => ({
    ajustes: { sensibilidad: 2, monitoreo: true, frecuencia: 120 },
    historial: { dias: {}, pausas: [], animos: [], ejemplo: false },
    hitos: [],
    notas: ''
  });
  let store = cargar();
  function cargar() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaults();
      const o = JSON.parse(raw);
      const d = defaults();
      return { ...d, ...o, ajustes: { ...d.ajustes, ...(o.ajustes || {}) }, historial: { ...d.historial, ...(o.historial || {}) } };
    } catch (e) { return defaults(); }
  }
  function guardar() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* almacenamiento no disponible */ }
    pintarInspector();
  }
  const dia = () => { const k = hoyKey(); return (store.historial.dias[k] = store.historial.dias[k] || { estudio: 0, pausa: 0 }); };

  /* ---------- Anuncios accesibles ---------- */
  const anunciar = (txt) => { const a = $('anuncios'); a.textContent = ''; setTimeout(() => { a.textContent = txt; }, 20); };

  /* ---------- Contador de red (HU-043) ---------- */
  let netCount = 0;
  const bumpNet = () => { netCount++; const el = $('net-count'); if (el) el.textContent = String(netCount); };
  try {
    if (window.fetch) { const f = window.fetch; window.fetch = function () { bumpNet(); return f.apply(this, arguments); }; }
    const xs = XMLHttpRequest.prototype.send; XMLHttpRequest.prototype.send = function () { bumpNet(); return xs.apply(this, arguments); };
    if (navigator.sendBeacon) { const sb = navigator.sendBeacon.bind(navigator); navigator.sendBeacon = function () { bumpNet(); return sb.apply(null, arguments); }; }
  } catch (e) { /* entorno restringido */ }

  /* ---------- Umbrales por sensibilidad (HU-007) ---------- */
  const UMBRALES = {
    1: { nombre: 'Baja', ventanas: 16, borrado: 0.50, dispersion: 120, niveles: [45, 75] },
    2: { nombre: 'Media', ventanas: 12, borrado: 0.40, dispersion: 90, niveles: [35, 65] },
    3: { nombre: 'Alta', ventanas: 8, borrado: 0.30, dispersion: 60, niveles: [25, 55] }
  };
  const IDLE_MS = 5 * 60 * 1000;          // HU-001 CA02: 5 min de inactividad
  const WIN_MS = 60 * 1000;               // HU-004: ventana de 60 s
  const TYPE_MS = 2 * 60 * 1000;          // HU-003: ventana de 2 min
  const CALC_MS = 60 * 1000;              // HU-006 CA03: recálculo cada 60 s
  const SUGGEST_FADE_MS = 15 * 1000;      // HU-010 CA03 / HU-017
  const POSTPONE_MS = 15 * 60 * 1000;     // HU-017 CA02
  const QUIET_MS = 20 * 60 * 1000;        // HU-021 CA03
  const EMPATIC_MS = 4 * 1000;            // HU-024 CA03

  /* ---------- Estado en memoria ---------- */
  const M = {
    escuchando: false, listeners: 0,
    inicio: null, ultimaActividad: null, idle: false, idleDesde: null,
    continuoMs: 0, ultimoTick: vnow(), pendEstudioMs: 0,
    ventanasTs: [], ultimoBlur: -1e9,
    tecleo: [], ultimoInput: null, intervalos: [],
    cursor: { last: null, speed: 0, acc: 0, win: [], lastMove: -1e9, hesitMs: 0 },
    sim: null, ultimoCalculo: vnow(), nivel: 'normal', indice: 0, comps: { time: 0, win: 0, typ: 0, cur: 0 },
    cooldownZen: 0, cooldownPausa: 0, quietHasta: 0, examenFin: 0,
    pausaActiva: false, marcador: null, lastSkipMs: null, lastZenExitMs: null, lastPurgeMs: null
  };
  const S = () => store.ajustes;

  /* ---------- Escucha pasiva (HU-001..004, HU-046) ---------- */
  function onActividad() {
    const t = vnow();
    if (M.idle) {                                   // reanudación tras pausa automática
      const reposoMin = Math.max(0, (t - M.idleDesde)) / 60000;
      dia().pausa += reposoMin;
      M.continuoMs = 0; M.idle = false; M.idleDesde = null;
    }
    if (M.inicio === null) M.inicio = t;            // HU-001 CA01: arranca solo por eventos de entrada
    M.ultimaActividad = t;
  }
  // Solo se lee el TIPO de entrada (inserción o borrado), jamás el carácter (HU-044).
  function onInput(e) {
    onActividad();
    const tg = e.target;
    const esTexto = tg && (tg.tagName === 'TEXTAREA' || (tg.tagName === 'INPUT' && /^(text|email|search|number|tel|url)$/.test(tg.type)));
    if (!esTexto) return;                              // controles como sliders o casillas no cuentan como tecleo
    const t = vnow();
    const borrado = typeof e.inputType === 'string' && e.inputType.indexOf('delete') === 0;
    M.tecleo.push({ t, d: borrado ? 1 : 0 });
    if (M.ultimoInput !== null) { M.intervalos.push(t - M.ultimoInput); if (M.intervalos.length > 50) M.intervalos.shift(); }
    M.ultimoInput = t;
  }
  function onMouse(e) {
    onActividad();
    const t = vnow(), c = M.cursor;
    if (c.last) {
      const dx = e.clientX - c.last.x, dy = e.clientY - c.last.y, dist = Math.hypot(dx, dy);
      if (dist >= 2) {
        const dt = Math.max(1, t - c.last.t), speed = dist / dt;
        c.acc = (speed - c.speed) / dt; c.speed = speed;
        const bin = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
        c.win.push({ t, bin }); c.lastMove = t;
        c.last = { x: e.clientX, y: e.clientY, t };
      }
    } else { c.last = { x: e.clientX, y: e.clientY, t }; }
  }
  function onClick() { onActividad(); M.cursor.win = []; }             // la entropía se calcula en trayectorias sin clics
  function onBlur() {
    onActividad();
    const t = vnow();
    if (t - M.ultimoBlur < 250) return;
    M.ultimoBlur = t; M.ventanasTs.push(t);
  }
  const LISTENERS = [
    [document, 'input', onInput, true],
    [document, 'mousemove', onMouse, { passive: true }],
    [document, 'mousedown', onClick, { passive: true }],
    [window, 'blur', onBlur, false]
  ];
  function iniciarEscucha() {
    if (M.escuchando) return;
    LISTENERS.forEach(([t, ev, fn, o]) => t.addEventListener(ev, fn, o));
    M.escuchando = true; M.listeners = LISTENERS.length; M.ultimoTick = vnow();
  }
  function detenerEscucha() {                                           // HU-046 CA02
    LISTENERS.forEach(([t, ev, fn, o]) => t.removeEventListener(ev, fn, o));
    M.escuchando = false; M.listeners = 0;
  }

  /* ---------- Métricas ---------- */
  function entropiaCursor(ahora) {
    const w = M.cursor.win = M.cursor.win.filter((p) => ahora - p.t <= 5000);
    if (w.length < 15) return 0;
    const h = new Array(8).fill(0); w.forEach((p) => h[p.bin]++);
    let H = 0; h.forEach((n) => { if (n) { const p = n / w.length; H -= p * Math.log(p); } });
    return H / Math.log(8);
  }
  function tasaBorrado(ahora) {
    M.tecleo = M.tecleo.filter((k) => ahora - k.t <= TYPE_MS);
    if (M.tecleo.length < 10) return 0;
    return M.tecleo.filter((k) => k.d).length / M.tecleo.length;
  }
  function ventanas60(ahora) { M.ventanasTs = M.ventanasTs.filter((t) => ahora - t <= WIN_MS); return M.ventanasTs.length; }
  function metricas() {
    const ahora = vnow();
    if (M.sim) return { ...M.sim };
    return { cont: M.continuoMs / 60000, vent: ventanas60(ahora), del: tasaBorrado(ahora), disp: M.cursor.hesitMs / 1000 };
  }
  function calcularIndice() {
    const m = metricas(), u = UMBRALES[S().sensibilidad];
    const c = {
      time: Math.min(1, m.cont / S().frecuencia),      // HU-049 CA03: modulación por frecuencia base
      win: Math.min(1, m.vent / u.ventanas),
      typ: Math.min(1, m.del / u.borrado),
      cur: Math.min(1, m.disp / u.dispersion)
    };
    const idx = Math.round(100 * (0.30 * c.time + 0.25 * c.win + 0.25 * c.typ + 0.20 * c.cur));
    M.comps = c; M.indice = idx;
    M.nivel = idx >= u.niveles[1] ? 'critica' : idx >= u.niveles[0] ? 'moderada' : 'normal';
    M.ultimoCalculo = vnow();
    pintarNivel();
    evaluarSugerencias();
  }
  function pintarNivel() {
    const texto = { normal: 'Normal', moderada: 'Fatiga moderada', critica: 'Sobrecarga crítica' }[M.nivel];
    $('nivel').dataset.level = M.nivel;
    $('nivel-texto').textContent = texto;
    $('indice-valor').textContent = String(M.indice);
    $('meter-fill').style.width = `${M.indice}%`;
    $('meter-indice').setAttribute('aria-valuenow', String(M.indice));
  }

  /* ---------- Bucle principal (1 s virtual) ---------- */
  function tick() {
    const ahora = vnow(), dt = ahora - M.ultimoTick; M.ultimoTick = ahora;
    if (M.escuchando) {
      if (M.ultimaActividad !== null && !M.idle) {
        if (ahora - M.ultimaActividad >= IDLE_MS) { M.idle = true; M.idleDesde = M.ultimaActividad + IDLE_MS; }    // HU-001 CA02
        else { M.continuoMs += dt; M.pendEstudioMs += dt; }
      }
      // dispersión del cursor (HU-002)
      const c = M.cursor, H = entropiaCursor(ahora);
      if (ahora - c.lastMove < 2000 && H >= 0.8) c.hesitMs += dt; else c.hesitMs = Math.max(0, c.hesitMs - dt * 0.5);
      if (M.pendEstudioMs >= 10000) volcarEstudio();
    }
    if (ahora - M.ultimoCalculo >= CALC_MS) calcularIndice();            // HU-006 CA03
    pintarMetricas(ahora);
    tickTimer(ahora); tickExamen(ahora);
  }
  function volcarEstudio() { if (M.pendEstudioMs > 0) { dia().estudio += M.pendEstudioMs / 60000; M.pendEstudioMs = 0; guardar(); pintarBalance(); } }
  function pintarMetricas(ahora) {
    const m = metricas();
    $('m-tiempo').textContent = M.sim ? fmtHMS(m.cont * 60000) : fmtHMS(M.continuoMs);
    $('m-ventanas').textContent = String(m.vent);
    $('m-borrado').textContent = `${Math.round(m.del * 100).toString().replace('.', ',')} %`;
    $('m-cursor').textContent = `${Math.round(m.disp)} s`;
    $('aviso-2h').hidden = !(m.cont >= 120);
    const seg = Math.floor((ahora - M.ultimoCalculo) / 1000);
    $('ultimo-calculo').textContent = `hace ${seg} s`;
    if (document.body.classList.contains('zen')) pintarAtenuacion();
  }

  /* ---------- Simulación para la demo ---------- */
  function simular(tipo) {
    if (tipo && typeof tipo === 'object') M.sim = { cont: 0, vent: 0, del: 0, disp: 0, ...tipo };   // gancho de pruebas
    else M.sim = tipo === 'alta' ? { cont: 130, vent: 14, del: 0.45, disp: 100 } : null;
    $('chip-simulacion').hidden = !M.sim;
    calcularIndice();
    $('btn-simular-alta').setAttribute('aria-pressed', String(!!M.sim));
    anunciar(M.sim ? 'Simulación de sobrecarga activada.' : 'Simulación detenida. Se muestran tus señales reales.');
  }

  /* ---------- Sensibilidad (HU-007) y frecuencia (HU-049) ---------- */
  function pintarSensibilidad() {
    const u = UMBRALES[S().sensibilidad];
    $('sensibilidad').value = String(S().sensibilidad);
    $('sensibilidad').setAttribute('aria-valuetext', u.nombre);
    $('sens-texto').textContent = u.nombre;
    $('umbrales-texto').textContent = `Umbrales: cambios de pestaña > ${u.ventanas} en 60 s · borrado > ${Math.round(u.borrado * 100)} % en 2 min · dispersión > ${u.dispersion} s.`;
  }
  $('sensibilidad').addEventListener('input', (e) => {
    S().sensibilidad = Number(e.target.value); guardar(); pintarSensibilidad(); calcularIndice();
    anunciar(`Sensibilidad ${UMBRALES[S().sensibilidad].nombre}.`);
  });
  function aplicarFrecuencia(v) {
    const n = clamp(Math.round(Number(v) || 120), 45, 150);
    S().frecuencia = n; guardar();
    $('frecuencia-consejo').hidden = !(n > 120);
    calcularIndice();
    return n;
  }
  $('frecuencia').addEventListener('input', (e) => { if (e.target.value !== '') aplicarFrecuencia(e.target.value); });
  $('frecuencia').addEventListener('change', (e) => { e.target.value = String(aplicarFrecuencia(e.target.value)); });

  /* ---------- Monitoreo activado/desactivado (HU-046) ---------- */
  function pintarMonitoreo() {
    const on = S().monitoreo;
    $('sw-monitoreo').setAttribute('aria-checked', String(on));
    $('tag-monitoreo').dataset.state = on ? 'activo' : 'pausa';
    $('tag-monitoreo').textContent = on ? 'Activo' : 'En pausa';
    $('chip-monitoreo').dataset.state = on ? 'activo' : 'pausa';
    $('chip-monitoreo-texto').textContent = on ? 'Monitoreo activo' : 'Monitoreo en pausa';
  }
  function setMonitoreo(on) {
    S().monitoreo = on; guardar();
    on ? iniciarEscucha() : detenerEscucha();
    pintarMonitoreo();
    anunciar(on ? 'Monitoreo adaptativo activo.' : 'Monitoreo adaptativo en pausa. FocusSync dejó de escuchar.');
  }
  $('sw-monitoreo').addEventListener('click', () => setMonitoreo(!S().monitoreo));

  /* ---------- Sugerencias no invasivas (HU-010, HU-017) ---------- */
  const zona = $('zona-sugerencias');
  function suprimido() { return !S().monitoreo || M.examenFin > vnow() || M.quietHasta > vnow() || M.pausaActiva; }
  function crearToast(html, clase) {
    const t = document.createElement('div');
    t.className = 'toast' + (clase ? ' ' + clase : '');
    t.innerHTML = html;
    zona.appendChild(t);
    return t;
  }
  function desvanecer(t, enMs) {
    const id = setTimeout(() => { t.classList.add('saliendo'); setTimeout(() => t.remove(), rms(1000) + 50); }, rms(enMs));
    t._timer = id;
  }
  function cerrarToast(t) { clearTimeout(t._timer); t.remove(); }
  function sugerirZen() {
    if (qs('.toast[data-tipo="zen"]')) return;
    M.cooldownZen = vnow() + S().frecuencia * 60000;
    const t = crearToast('<p><strong>Parece que hay mucha carga.</strong> ¿Simplificamos la pantalla con el Modo Zen?</p><div class="btn-row"><button type="button" class="btn btn--primary btn--sm" data-acc="si">Activar Modo Zen</button><button type="button" class="btn btn--ghost btn--sm" data-acc="no">Ahora no</button></div>');
    t.dataset.tipo = 'zen'; t.dataset.hu = 'HU-010';
    t.addEventListener('click', (e) => { const a = e.target.closest('[data-acc]'); if (!a) return; cerrarToast(t); if (a.dataset.acc === 'si') setZen(true); });
    desvanecer(t, SUGGEST_FADE_MS);
  }
  function sugerirPausa() {
    if (qs('.toast[data-tipo="pausa"]')) return;
    M.cooldownPausa = vnow() + S().frecuencia * 60000;
    const t = crearToast('<p>Notamos algo de tensión al usar el equipo. ¿Respiramos un minuto?</p><div class="btn-row"><button type="button" class="btn btn--primary btn--sm" data-acc="si">Tomar pausa (60 s)</button><button type="button" class="btn btn--outline btn--sm" data-acc="no">Posponer (15 min)</button></div>');
    t.dataset.tipo = 'pausa'; t.dataset.hu = 'HU-017';
    t.addEventListener('click', (e) => {
      const a = e.target.closest('[data-acc]'); if (!a) return; cerrarToast(t);
      if (a.dataset.acc === 'si') iniciarPausa('sugerencia'); else { M.cooldownPausa = vnow() + POSTPONE_MS; anunciar('Pausa pospuesta 15 minutos.'); }
    });
    desvanecer(t, SUGGEST_FADE_MS);
  }
  function evaluarSugerencias() {
    if (suprimido() || M.nivel === 'normal') return;
    const motor = M.comps.typ >= 1 || M.comps.cur >= 1;
    const ahora = vnow();
    if (motor && M.cooldownPausa <= ahora) sugerirPausa();
    else if (!document.body.classList.contains('zen') && M.cooldownZen <= ahora) sugerirZen();
  }

  /* ---------- Modo Zen (HU-009, 011, 012, 014, 016) ---------- */
  function pintarAtenuacion() {
    const op = parseFloat(getComputedStyle($('atenuacion')).opacity) || 0;
    $('atenuacion-estado').textContent = `Atenuación actual: ${Math.round(op * 100)} %`;
  }
  function objetivoAtenuacion() { return { normal: 0.10, moderada: 0.20, critica: 0.30 }[M.nivel]; }
  function contarPeriféricos() {
    const zen = document.body.classList.contains('zen');
    const n = zen ? qsa('.peripheral, .peripheral-soft').length : 0;
    $('paneles-minimizados').textContent = `Paneles minimizados: ${n}`;
  }
  function setZen(on) {
    const body = document.body;
    if (on === body.classList.contains('zen')) return;
    if (on) {
      body.classList.add('zen'); $('zenbar').hidden = false;
      $('atenuacion').classList.remove('rapido');
      requestAnimationFrame(() => { $('atenuacion').style.opacity = String(objetivoAtenuacion()); });   // gradual (>= 10 s)
      const f = document.activeElement;                                                                   // si se activó con el ratón, el foco pasa al botón de salida
      if (f && (f.id === 'btn-zen-barra' || f.id === 'btn-zen-seccion')) $('btn-salir-zen').focus();
      anunciar('Modo Zen activado. Pulsa Escape o el botón Salir para volver.');
    } else {
      const t0 = performance.now();                                                                       // HU-016 CA02
      const volverFoco = document.activeElement === $('btn-salir-zen');
      body.classList.add('zen-salir');
      body.classList.remove('zen'); $('zenbar').hidden = true;
      $('atenuacion').classList.add('rapido'); $('atenuacion').style.opacity = '0';
      if (volverFoco) $('btn-zen-barra').focus();
      requestAnimationFrame(() => { M.lastZenExitMs = Math.round(performance.now() - t0); body.classList.remove('zen-salir'); });
      anunciar('Saliste del Modo Zen.');
    }
    ['btn-zen-barra', 'btn-zen-seccion'].forEach((id) => $(id).setAttribute('aria-pressed', String(on)));
    $('btn-zen-seccion').textContent = on ? 'Salir de Modo Zen' : 'Activar Modo Zen';
    contarPeriféricos(); pintarAtenuacion();
  }
  const toggleZen = () => setZen(!document.body.classList.contains('zen'));
  ['btn-zen-barra', 'btn-zen-seccion'].forEach((id) => $(id).addEventListener('click', toggleZen));
  $('btn-salir-zen').addEventListener('click', () => setZen(false));
  $('btn-restaurar-brillo').addEventListener('click', () => {                                            // HU-011 CA03
    $('atenuacion').classList.add('rapido'); $('atenuacion').style.opacity = '0'; pintarAtenuacion(); anunciar('Brillo estándar restaurado.');
  });
  function setTareaUnica(on) {
    document.body.classList.toggle('single', on);
    $('btn-tarea-unica').setAttribute('aria-pressed', String(on));
    anunciar(on ? 'Vista de tarea única. Los demás paneles quedan minimizados, no cerrados.' : 'Vista normal.');
  }
  $('btn-tarea-unica').addEventListener('click', () => setTareaUnica(!document.body.classList.contains('single')));

  /* ---------- Atajos (solo combinaciones con Ctrl/Alt y Escape; el resto se ignora) ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('dlg-notas').hidden) { cerrarNotas(); e.preventDefault(); }
      else if (M.pausaActiva) { saltarPausa(); e.preventDefault(); }
      else if (!$('dlg-borrar').hidden) { cerrarDialogoBorrar(); }
      else if (document.body.classList.contains('zen')) { setZen(false); }
      return;
    }
    if (!(e.ctrlKey || e.altKey || e.metaKey)) return;                                                   // HU-044: ninguna otra tecla se interpreta
    const k = (e.key || '').toLowerCase();
    if (e.ctrlKey && e.shiftKey && k === 'z') { e.preventDefault(); toggleZen(); }
    else if (e.altKey && e.shiftKey && k === 'f') { e.preventDefault(); setTareaUnica(!document.body.classList.contains('single')); }
    else if (e.ctrlKey && !e.shiftKey && k === 'j') { e.preventDefault(); $('dlg-notas').hidden ? abrirNotas() : cerrarNotas(); }
  });

  /* ---------- Micro-pausa guiada (HU-018, 020, 021, 024) ---------- */
  const FASES = [['Inhala', 4000], ['Sostén', 2000], ['Exhala', 6000]];
  const CICLO = 12000, PAUSA_MS = 60000, CIRC = 339.29;
  let pausaInt = null, pausaInicio = 0, focoPrevio = null;
  function guardarMarcador() {                                                                          // HU-020 CA01
    const d = $('documento');
    M.marcador = { area: 'documento', caret: d.selectionStart, scroll: d.scrollTop, y: window.scrollY, activo: document.activeElement && document.activeElement.id };
  }
  function iniciarPausa(origen) {
    if (M.pausaActiva) return;
    guardarMarcador();
    M.pausaActiva = true; focoPrevio = document.activeElement;
    $('dlg-pausa').hidden = false; $('btn-saltar').focus();
    pausaInicio = vnow();
    $('estado-pausa').textContent = '';
    clearInterval(pausaInt); pausaInt = setInterval(pasoPausa, 33);
    pasoPausa();
    anunciar('Pausa de respiración iniciada.');
  }
  function pasoPausa() {
    const el = vnow() - pausaInicio;
    if (el >= PAUSA_MS) return terminarPausa(true, PAUSA_MS);
    const pos = el % CICLO; let acc = 0, fase = FASES[0], dentro = 0;
    for (const f of FASES) { if (pos < acc + f[1]) { fase = f; dentro = pos - acc; break; } acc += f[1]; }
    let esc;
    if (fase[0] === 'Inhala') esc = 0.6 + 0.4 * (dentro / fase[1]);
    else if (fase[0] === 'Sostén') esc = 1; else esc = 1 - 0.4 * (dentro / fase[1]);
    $('breath-sphere').style.transform = `scale(${esc.toFixed(3)})`;
    $('breath-fase').textContent = fase[0];
    $('breath-tiempo').textContent = fmtMS(Math.ceil((PAUSA_MS - el) / 1000) * 1000);
    $('breath-progress').style.strokeDashoffset = String((CIRC * el / PAUSA_MS).toFixed(2));
  }
  function terminarPausa(completa, durMs) {
    clearInterval(pausaInt); pausaInt = null;
    const dur = durMs !== undefined ? durMs : Math.min(PAUSA_MS, vnow() - pausaInicio);
    $('dlg-pausa').hidden = true; M.pausaActiva = false;
    store.historial.pausas.push({ ts: Date.now(), seg: Math.round(dur / 1000), completa });
    dia().pausa += dur / 60000;
    if (!completa) { M.quietHasta = vnow() + QUIET_MS; $('chip-silencio').hidden = false; $('chip-silencio').textContent = 'Sin sugerencias por 20 min'; setTimeout(() => { $('chip-silencio').hidden = true; }, rms(QUIET_MS)); }
    guardar(); pintarResumen(); pintarBalance();
    $('estado-pausa').textContent = completa ? 'Pausa completada. Bien hecho.' : 'Saltaste el ejercicio. Sin problema.';
    $('marcador-tarea').hidden = false;
    mostrarMensajeEmpatico();
    if (focoPrevio && focoPrevio.focus) focoPrevio.focus();
  }
  function saltarPausa() {                                                                              // HU-021 CA01-02
    const t0 = performance.now();
    terminarPausa(false);
    M.lastSkipMs = Math.round(performance.now() - t0);
  }
  $('btn-iniciar-pausa').addEventListener('click', () => iniciarPausa('manual'));
  $('btn-saltar').addEventListener('click', saltarPausa);
  $('btn-volver-tarea').addEventListener('click', () => {                                               // HU-020 CA02-03
    const m = M.marcador, d = $('documento');
    if (m) { d.focus(); d.setSelectionRange(m.caret, m.caret); d.scrollTop = m.scroll; }
    const w = $('espacio-trabajo'); w.classList.add('resaltado'); setTimeout(() => w.classList.remove('resaltado'), rms(3000));
    $('marcador-tarea').hidden = true;
    anunciar('Volviste a tu tarea pendiente.');
  });
  const FRASES = [
    'Pausar también es avanzar: tu atención rinde más cuando descansa.',
    'Respirar con calma ayuda a regular el estrés (Bentley et al., 2023).',
    'Un minuto de pausa es parte de la estrategia, no tiempo perdido.',
    'Volver con la mente despejada suele ser más eficaz que insistir cansado.'
  ];
  let fraseIdx = 0;
  function mostrarMensajeEmpatico() {                                                                  // HU-024
    if (M.examenFin > vnow()) return;
    const t = crearToast(`<p>${FRASES[fraseIdx++ % FRASES.length]}</p>`, 'toast--mensaje');
    t.dataset.tipo = 'empatico'; t.dataset.hu = 'HU-024';
    desvanecer(t, EMPATIC_MS);
  }

  /* ---------- Micro-hitos (HU-026) ---------- */
  const PLANTILLAS = {
    informe: [['Releer la rúbrica', 15], ['Redactar el planteamiento del problema', 40], ['Reunir 3 fuentes clave', 35], ['Escribir un borrador del primer apartado', 40], ['Revisar y ordenar las referencias', 30]],
    programacion: [['Leer el enunciado y listar requisitos', 15], ['Diseñar la estructura (diagrama o pseudocódigo)', 30], ['Implementar la función principal', 40], ['Probar con 3 casos', 25], ['Documentar y limpiar el código', 20]],
    estudio: [['Listar los temas del examen', 15], ['Resumir el tema 1', 40], ['Resolver 5 ejercicios del tema 1', 40], ['Resumir el tema 2', 40], ['Repaso rápido con preguntas propias', 30]],
    proyecto: [['Acordar roles y fechas con el equipo', 20], ['Dividir tareas en partes pequeñas', 25], ['Avanzar tu primera parte', 40], ['Revisar la parte de otra persona', 30], ['Integrar y compartir los cambios', 30]]
  };
  function pintarHitos() {
    const ul = $('lista-hitos'); ul.innerHTML = '';
    const h = store.hitos;
    $('hitos-resultado').hidden = !h.length;
    h.forEach((x, i) => {
      const li = document.createElement('li'); if (x.hecho) li.className = 'hecho';
      li.innerHTML = `<input type="checkbox" id="hito-c-${i}" ${x.hecho ? 'checked' : ''} aria-label="Marcar como completado: ${x.nombre.replace(/"/g, '&quot;')}">
        <input type="text" id="hito-n-${i}" value="${x.nombre.replace(/"/g, '&quot;')}" aria-label="Nombre del micro-hito ${i + 1}">
        <span class="mins"><label for="hito-m-${i}" class="sr-only">Minutos</label><input type="number" id="hito-m-${i}" min="5" max="44" value="${x.min}" inputmode="numeric"> min</span>`;
      ul.appendChild(li);
      li.querySelector(`#hito-c-${i}`).addEventListener('change', (e) => { x.hecho = e.target.checked; guardar(); pintarHitos(); });
      li.querySelector(`#hito-n-${i}`).addEventListener('change', (e) => { x.nombre = e.target.value.trim() || x.nombre; guardar(); });
      li.querySelector(`#hito-m-${i}`).addEventListener('change', (e) => { x.min = clamp(Math.round(Number(e.target.value) || x.min), 5, 44); e.target.value = String(x.min); guardar(); });
    });
    const hechos = h.filter((x) => x.hecho).length, pct = h.length ? Math.round(100 * hechos / h.length) : 0;
    $('hitos-fill').style.width = pct + '%'; $('meter-hitos').setAttribute('aria-valuenow', String(pct));
    $('hitos-progreso-texto').textContent = `${hechos} de ${h.length} completados`;
  }
  $('form-hitos').addEventListener('submit', (e) => {
    e.preventDefault();
    const nombre = $('h-nombre').value.trim(), err = $('h-nombre-err');
    if (nombre.length < 3) { err.textContent = 'Escribe el nombre del entregable (mínimo 3 caracteres).'; err.hidden = false; $('h-nombre').setAttribute('aria-invalid', 'true'); $('h-nombre').focus(); return; }
    err.hidden = true; $('h-nombre').removeAttribute('aria-invalid');
    store.hitos = PLANTILLAS[$('h-tipo').value].slice(0, 5).map(([n, m]) => ({ nombre: n, min: m, hecho: false }));
    store.hitosEntregable = nombre; guardar(); pintarHitos();
    anunciar(`Se crearon ${store.hitos.length} micro-hitos para ${nombre}.`);
  });

  /* ---------- Temporizador flexible (HU-028) ---------- */
  const T = { estado: 'idle', acum: 0, desde: 0 };
  const metaMs = () => clamp(Math.round(Number($('meta-min').value) || 45), 45, 90) * 60000;
  function elapsedTimer() { return T.acum + (T.estado === 'run' ? vnow() - T.desde : 0); }
  function tickTimer() {
    const el = elapsedTimer(), meta = metaMs(), d = $('timer-display');
    if (el > meta) {                                                                                  // conteo progresivo en positivo
      d.textContent = '+' + fmtMS(el - meta); d.classList.add('positivo');
      $('timer-estado').textContent = 'Meta alcanzada. Sigues en positivo: tú decides cuándo pausar.';
      $('chip-meta') || (() => { const c = document.createElement('span'); c.className = 'chip chip--quiet'; c.id = 'chip-meta'; c.textContent = 'Meta de sesión alcanzada'; $('franja-estado').appendChild(c); })();
    } else {
      d.textContent = fmtMS(el); d.classList.remove('positivo');
      const c = $('chip-meta'); if (c) c.remove();
    }
  }
  $('btn-timer').addEventListener('click', () => {
    if (T.estado === 'run') { T.acum = elapsedTimer(); T.estado = 'pausa'; $('btn-timer').textContent = 'Continuar'; $('timer-estado').textContent = 'En pausa.'; }
    else { T.desde = vnow(); T.estado = 'run'; $('btn-timer').textContent = 'Pausar'; $('timer-estado').textContent = 'En marcha. Al llegar a la meta no se bloquea nada.'; }
  });
  $('btn-timer-reset').addEventListener('click', () => { T.estado = 'idle'; T.acum = 0; $('btn-timer').textContent = 'Iniciar'; $('timer-estado').textContent = 'Listo para empezar. Al llegar a la meta no se bloquea nada: sigues en positivo.'; tickTimer(); });
  $('meta-min').addEventListener('change', (e) => { e.target.value = String(metaMs() / 60000); });

  /* ---------- Brain Dump (HU-031) ---------- */
  let focoNotas = null, notasTimer = null;
  function abrirNotas() { focoNotas = document.activeElement; $('dlg-notas').hidden = false; $('notas-texto').value = store.notas || ''; $('notas-texto').focus(); }
  function cerrarNotas() {
    clearTimeout(notasTimer); store.notas = $('notas-texto').value; guardar();
    $('dlg-notas').hidden = true; if (focoNotas && focoNotas.focus) focoNotas.focus();
  }
  $('btn-abrir-notas').addEventListener('click', abrirNotas);
  $('btn-cerrar-notas').addEventListener('click', cerrarNotas);
  $('notas-texto').addEventListener('input', () => {
    $('notas-estado').textContent = 'Guardando…';
    clearTimeout(notasTimer); notasTimer = setTimeout(() => { store.notas = $('notas-texto').value; guardar(); $('notas-estado').textContent = 'Guardado automático local.'; }, 250);
  });

  /* ---------- Bienestar: gráfico, ánimo y resumen (HU-035, 036, 037) ---------- */
  function rangoDias(p) {
    const n = p === 'dia' ? 1 : p === 'semana' ? 7 : 30, out = [];
    for (let i = n - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); out.push({ k: d.toLocaleDateString('en-CA'), d }); }
    return out;
  }
  function pintarBalance() {
    const p = (qs('input[name="periodo"]:checked') || {}).value || 'semana';
    const dias = rangoDias(p), datos = dias.map((x) => ({ ...x, ...(store.historial.dias[x.k] || { estudio: 0, pausa: 0 }) }));
    const totE = datos.reduce((a, b) => a + b.estudio, 0), totP = datos.reduce((a, b) => a + b.pausa, 0);
    const W = 560, H = 210, mx = Math.max(10, ...datos.map((d) => Math.max(d.estudio, d.pausa))), bw = Math.min(34, (W - 50) / (datos.length * 2.4));
    let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><line x1="36" y1="170" x2="${W - 6}" y2="170" stroke="#8F8C70" stroke-width="1.5"/>`;
    [0, .5, 1].forEach((f) => { const y = 170 - 150 * f; svg += `<line x1="36" y1="${y}" x2="${W - 6}" y2="${y}" stroke="#CFCBB0" stroke-width="1"/><text x="32" y="${y + 4}" text-anchor="end" font-size="11" fill="#5F5D49">${Math.round(mx * f)}</text>`; });
    const slot = (W - 46) / datos.length;
    datos.forEach((d, i) => {
      const x = 40 + i * slot + (slot - bw * 2.1) / 2, hE = 150 * d.estudio / mx, hP = 150 * d.pausa / mx;
      svg += `<rect x="${x}" y="${170 - hE}" width="${bw}" height="${hE}" rx="3" fill="#6B6A4E"/><rect x="${x + bw * 1.1}" y="${170 - hP}" width="${bw}" height="${hP}" rx="3" fill="#A5503F"/>`;
      const lbl = p === 'dia' ? 'Hoy' : p === 'semana' ? ['D', 'L', 'M', 'X', 'J', 'V', 'S'][d.d.getDay()] : (d.d.getDate() % 5 === 0 ? String(d.d.getDate()) : '');
      svg += `<text x="${x + bw * 1.05}" y="188" text-anchor="middle" font-size="11" fill="#5F5D49">${lbl}</text>`;
    });
    svg += '<text x="36" y="12" font-size="11" fill="#5F5D49">minutos</text></svg>';
    $('grafico-balance').innerHTML = svg;
    $('grafico-balance').setAttribute('aria-label', `Gráfico de barras. Estudio total ${Math.round(totE)} minutos y pausas ${Math.round(totP)} minutos en el periodo ${p}.`);
    const ind = $('balance-indicador');
    if (totE < 1 && totP < 1) { ind.dataset.state = ''; ind.textContent = 'Aún no hay datos. Usa la demo o carga datos de ejemplo.'; return; }
    const ratio = totP / Math.max(1, totE), pc = Math.round(ratio * 100);
    if (ratio >= 0.2) { ind.dataset.state = 'ok'; ind.textContent = `✓ Equilibrio saludable: tus pausas equivalen al ${pc} % del tiempo de estudio (sugerido: 20 % o más).`; }
    else { ind.dataset.state = 'bajo'; ind.textContent = `⚠ Por debajo de lo sugerido: tus pausas equivalen al ${pc} % del tiempo de estudio (sugerido: 20 % o más).`; }
  }
  qsa('input[name="periodo"]').forEach((r) => r.addEventListener('change', pintarBalance));
  $('btn-datos-ejemplo').addEventListener('click', () => {
    const e = [[190, 24], [150, 35], [220, 20], [175, 40], [130, 30], [60, 15], [95, 25]];
    rangoDias('semana').forEach((x, i) => { store.historial.dias[x.k] = { estudio: e[i][0], pausa: e[i][1] }; });
    store.historial.ejemplo = true; guardar(); pintarBalance(); anunciar('Datos de ejemplo cargados.');
  });
  const ANIMOS = { 1: ['😣', 'Agotado'], 2: ['😕', 'Cansado'], 3: ['😐', 'Neutral'], 4: ['🙂', 'Bien'], 5: ['😄', 'Muy bien'] };
  function pintarAnimos() {
    const ol = $('historial-animo'); ol.innerHTML = '';
    store.historial.animos.slice(-5).reverse().forEach((a) => {
      const li = document.createElement('li'); const m = Math.round(a.estudioMin);
      li.textContent = `${new Date(a.ts).toLocaleDateString('es-PE')} · ${ANIMOS[a.valor][0]} ${ANIMOS[a.valor][1]} · ${Math.floor(m / 60)} h ${pad(m % 60)} min trabajados`;
      ol.appendChild(li);
    });
  }
  $('btn-cerrar-jornada').addEventListener('click', () => { $('panel-animo').hidden = false; $('animo-confirmacion').textContent = ''; qs('.mood').focus(); });
  qsa('.mood').forEach((b) => b.addEventListener('click', () => {                                      // un clic registra (HU-036 CA02)
    const v = Number(b.dataset.mood), est = dia().estudio;
    store.historial.animos.push({ ts: Date.now(), valor: v, estudioMin: est });
    guardar(); $('panel-animo').hidden = true; pintarAnimos();
    const m = Math.round(est);
    $('animo-confirmacion').textContent = `Registrado: ${ANIMOS[v][1]}. Hoy llevas ${Math.floor(m / 60)} h ${pad(m % 60)} min de estudio.`;
    anunciar($('animo-confirmacion').textContent);
  }));
  $('btn-omitir-animo').addEventListener('click', () => { $('panel-animo').hidden = true; $('animo-confirmacion').textContent = 'Sin problema, puedes registrarlo otro día.'; });
  function pintarResumen() {
    const sem = Date.now() - 7 * 86400000;
    const ps = store.historial.pausas.filter((p) => p.ts >= sem);
    const comp = ps.filter((p) => p.completa).length, min = ps.reduce((a, b) => a + b.seg, 0) / 60;
    $('res-ejercicios').textContent = String(comp);
    $('res-minutos').textContent = String(Math.round(min * 10) / 10).replace('.', ',');
    $('res-mensaje').textContent = comp > 0 ? `¡Bien! Esta semana ya cuidaste tu atención ${comp} ${comp === 1 ? 'vez' : 'veces'}. Seguimos a tu ritmo.` : 'Cada pausa cuenta. Cuando quieras, aquí verás tu progreso.';
  }

  /* ---------- Modo Examen (HU-047) ---------- */
  function tickExamen(ahora) {
    const chip = $('chip-examen');
    if (M.examenFin > 0) {
      if (ahora >= M.examenFin) { desactivarExamen(true); return; }
      chip.hidden = false; chip.textContent = `Modo Examen activo · termina en ${fmtMS(M.examenFin - ahora)}`;
    }
  }
  function activarExamen() {
    const min = Number($('examen-min').value) || 120;
    M.examenFin = vnow() + min * 60000;
    qsa('.toast', zona).forEach(cerrarToast);                                                             // suprime todo lo que estuviera visible
    $('btn-examen').setAttribute('aria-pressed', 'true'); $('btn-examen').textContent = 'Desactivar Modo Examen';
    $('examen-estado').textContent = `Activo por ${min} minutos. No habrá sugerencias ni avisos.`;
    anunciar('Modo Examen activado.');
  }
  function desactivarExamen(auto) {
    M.examenFin = 0; $('chip-examen').hidden = true;
    $('btn-examen').setAttribute('aria-pressed', 'false'); $('btn-examen').textContent = 'Activar Modo Examen';
    $('examen-estado').textContent = auto ? 'El tiempo terminó: Modo Examen desactivado automáticamente.' : 'Modo Examen desactivado.';
    anunciar($('examen-estado').textContent);
  }
  $('btn-examen').addEventListener('click', () => (M.examenFin > 0 ? desactivarExamen(false) : activarExamen()));

  /* ---------- Borrado total (HU-045) ---------- */
  let focoBorrar = null;
  function abrirDialogoBorrar() { focoBorrar = document.activeElement; $('dlg-borrar').hidden = false; $('btn-borrar-cancel').focus(); }
  function cerrarDialogoBorrar() { $('dlg-borrar').hidden = true; if (focoBorrar && focoBorrar.focus) focoBorrar.focus(); }
  $('btn-borrar').addEventListener('click', abrirDialogoBorrar);
  $('btn-borrar-cancel').addEventListener('click', cerrarDialogoBorrar);
  $('btn-borrar-ok').addEventListener('click', () => {
    const t0 = performance.now();
    try { Object.keys(localStorage).filter((k) => k.indexOf('focussync') === 0).forEach((k) => localStorage.removeItem(k)); sessionStorage.clear(); } catch (e) { /* sin acceso */ }
    store = defaults(); M.pendEstudioMs = 0; M.continuoMs = 0; M.marcador = null;
    pintarTodo(false);
    M.lastPurgeMs = Math.round(performance.now() - t0);
    $('dlg-borrar').hidden = true;
    $('borrar-estado').textContent = 'Listo: se eliminaron todos tus datos de estudio de este dispositivo.';
    anunciar($('borrar-estado').textContent);
    $('btn-borrar').focus();
  });

  /* ---------- Inspector de datos (HU-043/044) ---------- */
  function pintarInspector() {
    const dias = {}; Object.keys(store.historial.dias).sort().slice(-7).forEach((k) => { dias[k] = { estudio_min: Math.round(store.historial.dias[k].estudio), pausa_min: Math.round(store.historial.dias[k].pausa) }; });
    $('inspector-datos').textContent = JSON.stringify({
      configuracion: store.ajustes,
      minutos_por_dia: dias,
      pausas_registradas: store.historial.pausas.length,
      animos: store.historial.animos.map((a) => ({ valor: a.valor, estudio_min: Math.round(a.estudioMin) })),
      micro_hitos: store.hitos.length,
      notas_brain_dump: store.notas ? `${store.notas.length} caracteres escritos por ti (solo en este dispositivo)` : 'vacío',
      texto_del_documento: 'nunca se guarda',
      teclas_o_caracteres: 'nunca se registran'
    }, null, 2);
  }

  /* ---------- Formulario de contacto ---------- */
  function marcar(id, msg) {
    const el = $(id), err = $(id + '-err');
    if (msg) { err.textContent = msg; err.hidden = false; el.setAttribute('aria-invalid', 'true'); } else { err.hidden = true; el.removeAttribute('aria-invalid'); }
    return !msg;
  }
  $('form-contacto').addEventListener('submit', (e) => {
    e.preventDefault();
    const nombre = $('c-nombre').value.trim(), correo = $('c-correo').value.trim(), seg = $('c-segmento').value;
    const r = [
      marcar('c-nombre', nombre.length >= 3 ? '' : 'Escribe tu nombre completo (mínimo 3 caracteres).'),
      marcar('c-correo', /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo) ? '' : 'Escribe un correo válido, por ejemplo nombre@correo.com.'),
      marcar('c-segmento', seg ? '' : 'Selecciona la opción con la que te identificas.')
    ];
    const ok = $('c-exito');
    if (r.every(Boolean)) { ok.textContent = `Gracias, ${nombre.split(' ')[0]}. Esta demo no envía datos; en una versión real te avisaríamos al correo indicado.`; ok.hidden = false; anunciar(ok.textContent); }
    else { ok.hidden = true; const primero = qs('[aria-invalid="true"]'); if (primero) primero.focus(); }
  });

  /* ---------- Menú móvil ---------- */
  $('menu-toggle').addEventListener('click', () => {
    const abierto = $('menu-principal').classList.toggle('abierto');
    $('menu-toggle').setAttribute('aria-expanded', String(abierto));
  });
  qsa('#menu-principal a').forEach((a) => a.addEventListener('click', () => { $('menu-principal').classList.remove('abierto'); $('menu-toggle').setAttribute('aria-expanded', 'false'); }));

  /* ---------- Simulación (botones) ---------- */
  $('btn-simular-alta').addEventListener('click', () => simular('alta'));
  $('btn-simular-normal').addEventListener('click', () => simular('normal'));

  /* ---------- Trampa de foco en diálogos modales ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const dlg = ['dlg-pausa', 'dlg-borrar'].map($).find((d) => !d.hidden);
    if (!dlg) return;
    const f = qsa('button, [href], input, select, textarea', dlg).filter((x) => !x.disabled);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { f[f.length - 1].focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { f[0].focus(); e.preventDefault(); }
  });

  /* ---------- Pintado inicial ---------- */
  function pintarTodo(inicial) {
    pintarSensibilidad(); pintarMonitoreo(); pintarNivel(); pintarHitos(); pintarAnimos(); pintarResumen(); pintarBalance(); pintarInspector();
    $('frecuencia').value = String(S().frecuencia); $('frecuencia-consejo').hidden = !(S().frecuencia > 120);
    if (!inicial) { M.sim = null; $('chip-simulacion').hidden = true; M.nivel = 'normal'; M.indice = 0; pintarNivel(); }
    contarPeriféricos();
  }
  pintarTodo(true);
  S().monitoreo ? iniciarEscucha() : detenerEscucha();
  setInterval(tick, 250 / TS);                       // 4 actualizaciones por segundo (el reloj interno usa dt real)
  window.addEventListener('beforeunload', volcarEstudio);
  document.addEventListener('visibilitychange', () => { if (document.hidden) volcarEstudio(); });

  /* ---------- API de depuración (solo lectura + simulación) ---------- */
  window.FocusSync = {
    version: '1.0', timescale: TS,
    umbrales: UMBRALES,
    simular, calcular: calcularIndice,
    estado: () => ({
      escuchando: M.escuchando, listeners: M.listeners, nivel: M.nivel, indice: M.indice, comps: { ...M.comps },
      continuoMs: M.continuoMs, idle: M.idle, ventanas60: M.ventanasTs.length,
      borrado: tasaBorrado(vnow()), dispersionSeg: M.cursor.hesitMs / 1000,
      lastSkipMs: M.lastSkipMs, lastZenExitMs: M.lastZenExitMs, lastPurgeMs: M.lastPurgeMs,
      examenActivo: M.examenFin > vnow(), quietActivo: M.quietHasta > vnow(), pausaActiva: M.pausaActiva,
      redSolicitudes: netCount, marcador: M.marcador ? { ...M.marcador } : null
    }),
    forzarIdle: (ms) => { M.ultimaActividad = vnow() - ms; },
    ajustarTimer: (ms) => { T.acum += ms; },                      // gancho de pruebas: adelanta el temporizador
    store: () => JSON.parse(JSON.stringify(store))
  };
})();
