/**
 * MetaVr · calidad adaptativa.
 *
 * El objetivo no es "mantener 60 FPS sí o sí", sino no quedarse por debajo
 * de lo cómodo para el ojo. En un Quest 3S la diferencia entre 72 y 60 FPS
 * no se nota; entre 50 y 40, sí.
 *
 * Solo aplicamos UN cambio cuando bajamos de umbral, y solo uno cuando
 * subimos: alternar varios a la vez produce oscilación. El orden importa:
 * primero lo que no se ve (filtro óptico), después sombras, después niebla
 * y por último el foveation, porque degradar la nitidez es lo último que
 * queremos.
 *
 * Tres de los cuatro ajustes no se pueden deshacer en caliente de forma
 * fiable, así que solo se suben al detectar margen sostenido.
 */
(function (MV) {
  'use strict';

  var util = MV.util;
  var CONFIG = MV.CONFIG;
  var perf = {};

  var sceneEl = null;
  var renderer = null;
  var level = 0;              // 0 = pleno, 1 = sin filtro, 2 = ligero
  var samples = [];
  var lastChange = 0;
  var cooldown = 2500;        // ms entre cambios: evita oscilar
  var sustained = 0;          // frames seguidos por debajo del umbral
  var listener = null;        // callback para que optical.js aplique el cambio
  var fps = 60;

  /* ------------------------------------------------------------------ *
   * Medición
   * ------------------------------------------------------------------ */

  /**
   * Medimos con los tiempos de frame reales de A-Frame, no con un
   * `setInterval` de reloj: si el navegador decide no pintar, el intervalo
   * sigue diciendo "voy bien" y el usuario ve tirones.
   */
  function measure(dt) {
    // dt en segundos puede ser un pico tras una pausa de pestaña; lo
    // descartamos porque no representa el rendimiento real.
    if (dt <= 0 || dt > 0.5) { return; }
    samples.push(1 / dt);
    if (samples.length > 120) { samples.shift(); }
  }

  function currentFps() {
    if (!samples.length) { return 60; }
    var sum = 0;
    for (var i = 0; i < samples.length; i++) { sum += samples[i]; }
    return sum / samples.length;
  }

  /* ------------------------------------------------------------------ *
   * Cambios de nivel
   * ------------------------------------------------------------------ */

  function canChange(now) {
    return now - lastChange > cooldown;
  }

  function downgrade(now) {
    if (level >= 2) { return false; }
    level += 1;
    lastChange = now;
    sustained = 0;
    samples.length = 0;
    apply();
    return true;
  }

  function upgrade(now) {
    if (level <= 0) { return false; }
    level -= 1;
    lastChange = now;
    sustained = 0;
    samples.length = 0;
    apply();
    return true;
  }

  /**
   * Los ajustes que dependen del nivel. `optical` es el único que lo
   * escucha de verdad; el resto se resuelve inline porque son una línea.
   */
  function apply() {
    if (!renderer) { return; }

    // Nivel 1: fuera el filtro óptico. Es lo más caro (el cubemap son 6
    // renders extra) y lo menos molesta al usuario.
    var optical = level < 1;
    if (listener) { listener(optical, level); }

    // Nivel 2: sin sombras y sin niebla. Aquí ya asumimos que la sesión
    // va justa, y ambas cosas cuestan una pasada de render cada una.
    var shadows = level < 2;
    renderer.shadowMap.enabled = shadows;
    // La niebla del componente `fog` de A-Frame vive en object3D.fog, no en
    // el elemento. Tocar sceneEl.fog no da error, no hace nada, y el modo
    // ligero parece funcionar mientras la niebla sigue ahí.
    var fog = sceneEl && sceneEl.object3D ? sceneEl.object3D.fog : null;
    if (fog && fog.color) {
      fog.near = shadows ? CONFIG.scene.fogNear : 6;
      fog.far = shadows ? CONFIG.scene.fogFar : 40;
    }

    util.log('Calidad → nivel ' + level + (optical ? '' : ' (filtro off)'));
  }

  /* ------------------------------------------------------------------ *
   * API
   * ------------------------------------------------------------------ */

  perf.init = function (el, onChange) {
    sceneEl = el;
    renderer = el.renderer;
    listener = onChange || null;

    // Foveation: lo activamos siempre. En un visor con una pantalla por
    // ojo esto casi no cuesta y es lo que más FPS devuelve por vatio de
    // GPU.
    if (el.enterVR && el.enterVRButton) {
      try {
        el.enterVRButton.addEventListener('click', function () {
          el.renderer.xr.setFoveation(0.6);
        }, { once: true });
      } catch (e) {
        util.warnOnce('foveation', 'No se pudo preparar el foveation.', e);
      }
    }

    // PhysicallyCorrectLights / toneMapping los deja A-Frame como toca;
    // aquí no los tocamos porque un cambio de toneMapping a mitad de
    // sesión hace un salto de brillo muy visible.
    util.log('Calidad adaptativa activa.');
    return perf;
  };

  perf.tick = function (dt) {
    measure(dt);
    if (samples.length < 45) { return; }   // deja que se estabilice
    var now = performance.now();
    if (!canChange(now)) { return; }

    fps = currentFps();
    if (fps < CONFIG.perf.liteModeFps) {
      sustained += 1;
      if (sustained > 45) { downgrade(now); }
    } else {
      sustained = 0;
    }
  };

  /**
   * Sube calidad solo si hay margen de sobra. No se llama desde el tick:
   * lo invoca el temporizador de "todo bien desde hace rato".
   */
  perf.considerUpgrade = function () {
    if (level <= 0 || !canChange(performance.now())) { return false; }
    // Margen amplio: subir con 58 FPS en el nivel 1 es tirar el trabajo.
    return fps > CONFIG.perf.liteModeFps + 12 ? upgrade(performance.now()) : false;
  };

  perf.level = function () { return level; };
  perf.fps = function () { return fps; };
  perf.opticalEnabled = function () { return level < 1; };
  perf.shadowsEnabled = function () { return level < 2; };

  /** Reinicia la medición. Se usa tras cambiar de variante o de ronda. */
  perf.reset = function () { samples.length = 0; sustained = 0; };

  MV.perf = perf;
}(window.MV = window.MV || {}));
