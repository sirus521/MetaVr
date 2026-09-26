/**
 * MetaVr · arranque.
 *
 * El orden importa y está en un solo sitio, que es justo lo que evita la
 * mitad de los bugs en un proyecto con nueve sistemas.
 *
 * Secuencia:
 *   1. esperar a que la escena de A-Frame esté en pantalla
 *   2. registrar shaders y materiales (antes de crear geometría)
 *   3. montar la escena: cámara, luces, cielo, fondo
 *   4. construir el modelo y meterlo en una entidad física
 *   5. física → agarre → óptica → HUD 2D → HUD 3D → showroom → juego → easter eggs
 *   6. enganchar el bucle único de tick
 *
 * El paso 6 es el importante: NO usamos `setInterval` ni un `<a-animation>`
 * por sistema. Todo lo que se mueve pasa por un único `requestAnimationFrame`,
 * que además es el mismo frame que pinta A-Frame. Con varios bucles sueltos,
 * el orden de actualización deja de ser determinista y aparecen
 * interferencias que solo se ven a 60 FPS dentro de un visor.
 */
(function (MV) {
  'use strict';

  var util = MV.util;
  var CONFIG = MV.CONFIG;
  var main = {};

  var sceneEl = null;
  var running = false;
  var last = 0;
  var clock = 0;
  var loopId = 0;
  var hands = {};

  /* ------------------------------------------------------------------ *
   * Entrada: detectar el entorno de ejecución
   * ------------------------------------------------------------------ */

  /**
   * La página tiene que saber si es razonable ofrecer "Entrar en VR".
   * Un Quest en su navegador sí soporta WebXR, pero en un escritorio sin
   * nada conectado el botón solo es ruido.
   */
  function isStandalone() {
    return /Quest| Oculus Browser|Headsets/i.test(navigator.userAgent);
  }

  function hasWebXR() {
    return !!(navigator.xr && navigator.xr.isSessionSupported);
  }

  /* ------------------------------------------------------------------ *
   * Construcción
   * ------------------------------------------------------------------ */

  function buildGlasses() {
    var res = MV.glasses.build.build();
    res.group.traverse(function (obj) {
      if (obj.isMesh) {
        obj.castShadow = true;
        // receiveShadow solo en las piezas grandes: en las pequeñas no se
        // ve y cuesta un test por fragmento.
        obj.receiveShadow = false;
      }
    });
    return res;
  }

  /* ------------------------------------------------------------------ *
   * Bucle
   * ------------------------------------------------------------------ */

  /**
   * Un solo tick para todo. `dt` va en segundos y acotado: si la pestaña
   * estuvo en segundo plano, el primer dt puede ser de varios segundos y
   * haría que las animaciones dieran un salto y la física se disparara.
   */
  function frame(now) {
    loopId = requestAnimationFrame(frame);
    if (!running) { return; }

    var dt = last ? (now - last) / 1000 : 1 / 60;
    last = now;
    if (dt > 0.1) { dt = 1 / 60; }        // pestaña dormida o pausa larga
    if (dt <= 0) { return; }
    clock += dt;

    // 1. Nuestro propio tiempo, para los shaders de holograma.
    MV.materials.tick(clock);

    // 2. Escena: cámara, fondo.
    MV.stage.tick(dt);

    // 3. Óptica antes de la física: el cubemap debe estar en la posición
    //    del visor del frame anterior, que es la que se ha movido con la
    //    física del paso anterior.
    MV.optical.tick(dt);

    // 4. El agarre mueve el ancla antes de que la física dé un paso: si
    //    fuese al revés, la restricción iría siempre un frame por detrás y
    //    el objeto se quedaría "pegado" un frame.
    MV.grab.tick(dt);

    // 5. Asiento del pedestal. Va antes que el resto porque es física de
    //    verdad (decide la posición en la que el visor se queda quieto) y
    //    solo existe si el sistema de física está disponible.
    if (MV.physics && MV.physics.tick) { MV.physics.tick(dt); }

    // 6. Resto de sistemas.
    MV.showroom.tick(dt);
    MV.game.tick(dt);
    MV.ui3d.tick(dt);
    MV.hud.tick(dt);
    MV.easter.tick(dt, (performance.now() - hands.last) / 1000);
    MV.perf.tick(dt);
  }

  /* ------------------------------------------------------------------ *
   * Entrada unificada
   * ------------------------------------------------------------------ */

  /**
   * Un solo manejador para "el usuario ha pulsado". Antes de mirar los
   * botones del HUD, se le da oportunidad al agarre: si hay una bola bajo
   * la mano, esa es la intención.
   */
  function onSelect() {
    hands.last = performance.now();
    if (MV.grab.isGrabbing()) { return; }
    if (MV.ui3d.pressIfHit()) { return; }

    // Ni bola ni botón: ¿hay un hotspot cerca?
    var hs = MV.showroom.hotspotUnderHand();
    if (hs) {
      MV.easter.hotspotSeen(hs);
      MV.showroom.activate(hs.__mvHotspot.id);
    }
  }

  /**
   * Raton. En 2D el puntero hace doble trabajo: mueve el punto de mano y
   * dispara el mismo `onSelect`. Así el 2D y el VR comparten la lógica
   * entera en vez de tener dos implementaciones que divergen.
   */
  function onPointer(e) {
    hands.last = performance.now();
    MV.stage.moveHandFromPointer(e.clientX, e.clientY);
  }

  function onClick(e) {
    onPointer(e);
    onSelect();
  }

  function onRelease() {
    hands.last = performance.now();
    // El agarre ya se suelta solo en `mouseup`/`triggerup`; aquí solo
    // registramos que el usuario sigue despierto (lo usa el easter egg de
    // "te estoy mirando").
  }

  /**
   * Un único sitio donde se decide qué hace cada botón.
   *
   * Lo comparten el HUD 2D y el HUD 3D a propósito: si cada uno llamara a
   * su manera, cualquier botón nuevo habría que implementarlo dos veces y
   * tarde o temprano se desincronizarían. `ui3d` emite `mv:ui` con un id y
   * aquí se traduce a una llamada.
   */
  function runAction(id) {
    hands.last = performance.now();
    switch (id) {
      case 'optical':  MV.showroom.toggleOptical(); break;
      case 'variant':  MV.showroom.cycleVariant(); break;
      case 'explode':  MV.showroom.toggleExplode(); break;
      case 'wear':     MV.showroom.setWorn(!MV.optical.isWorn()); break;
      case 'game':     MV.game.toggle(); break;
      default:
        // Un id desconocido no es motivo para romper la página: se ignora.
        util.warnOnce('action', 'Acción desconocida: ' + id);
    }
  }

  /* ------------------------------------------------------------------ *
   * Arranque
   * ------------------------------------------------------------------ */

  function boot(scene) {
    sceneEl = scene;
    var s = CONFIG.scene;

    /* 2. Materiales y shaders antes que geometría */
    MV.materials.registerShaders();
    MV.materials.applyVariant(Object.keys(CONFIG.variants)[0]);

    /* 3. Escena */
    MV.stage.build(scene, MV.orbit);
    MV.orbit.init({
      camera: MV.stage.camera,
      target: new THREE.Vector3(0, s.pedestalY + 0.03, s.pedestalZ),
      radius: 1.45,
      theta: util.rad(16),
      phi: util.rad(74),
      minRadius: 0.40,
      maxRadius: 3.0
    });

    /* 4. Modelo */
    var glasses = buildGlasses();

    /* 5. Sistemas */
    MV.physics.setup(scene, { glassesGroup: glasses.group, meta: glasses.meta });
    if (!MV.physics.glassesEl) {
      // Sin física no hay agarre ni juego, pero la página tiene que verse
      // igual: el visor se queda como un modelo bonito y el resto de
      // sistemas (óptica, showroom, HUD) se inicializan igual. Si no, los
      // botones que llaman a `optical` o a `game` reventarían al pulsarlos.
      util.warnOnce('no-physics',
        'Sin sistema de física: el visor será estático y no habrá minijuego.');
      var lonely = util.entity({ id: 'visor' });
      lonely.setObject3D('mesh', glasses.group);
      scene.appendChild(lonely);

      MV.optical.init(scene, glasses.meta.lens);
      MV.optical.attach(scene);

      MV.showroom.init({ visorEl: lonely, group: glasses.group,
        camEl: MV.stage.cameraEl, meta: glasses.meta });
      MV.hud.init(document.body);
      MV.ui3d.init(scene);
      MV.easter.init();
      hookInput();

      running = true;
      last = 0;
      loopId = requestAnimationFrame(frame);

      MV.optical.prime(lonely);
      MV.hud.ready();
      return false;
    }

    MV.grab.init(scene, MV.stage.handObject());
    MV.grab.register(MV.physics.glassesEl, { canGrab: true });

    MV.optical.init(scene, glasses.meta.lens);
    MV.optical.attach(scene);

    MV.hud.init(document.body);
    MV.ui3d.init(scene);
    MV.showroom.init({
      visorEl: MV.physics.glassesEl,
      group: glasses.group,
      camEl: MV.stage.cameraEl,
      meta: glasses.meta
    });
    MV.game.init(scene, { visorEl: MV.physics.glassesEl });
    MV.easter.init();
    MV.perf.init(scene, function (opticalOn) {
      // El filtro es lo primero que se cae y lo último que vuelve.
      MV.optical.setEnabled(opticalOn);
    });

    hookInput();

    running = true;
    last = 0;
    loopId = requestAnimationFrame(frame);

    // Primera captura del cubemap y primer mensaje, ya con todo montado.
    MV.optical.prime();
    MV.hud.ready();
    MV.hud.decorateVRButton(scene);

    if (!hasWebXR()) {
      MV.util.warnOnce('webxr',
        'Este navegador no expone WebXR: la parte 3D funciona, la de VR no.');
    }
    return true;
  }

  function hookInput() {
    hands.last = performance.now();

    // El agarre ya escucha `selectstart`/`selectend` por su cuenta para
    // coger bolas; nosotros escuchamos para los botones y los hotspots.
    // Los dos están en la escena y no interfieren: cada uno filtra lo
    // suyo (el agarre mira si hay agarrable, el HUD mira si hay botón).
    sceneEl.addEventListener('selectstart', onSelect);
    sceneEl.addEventListener('triggerdown', onSelect);
    sceneEl.addEventListener('mousedown', onClick);
    sceneEl.addEventListener('touchstart', onClick);
    window.addEventListener('mouseup', onRelease);
    sceneEl.addEventListener('touchend', onRelease);
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('keydown', function (e) { hands.last = performance.now(); });

    // El HUD 3D no llama a los módulos directamente: emite el id y deja
    // que main decida, igual que el HUD 2D.
    document.addEventListener('mv:ui', function (e) {
      if (e && e.detail) { runAction(e.detail.action); }
    });
  }

  /* ------------------------------------------------------------------ *
   * API
   * ------------------------------------------------------------------ */

  main.start = function () {
    util.whenSceneReady().then(function (scene) {
      try {
        boot(scene);
      } catch (err) {
        // Un fallo aquí deja la escena en negro sin explicación. Peor que
        // un error: es un error mudo. Lo mostramos en el DOM.
        showFatal(err);
        throw err;
      }
    }).catch(function (err) {
      showFatal(err);
    });
  };

  /**
   * Fallo catastrófico: la escena no arrancó. Escribimos el motivo en
   * pantalla, porque la consola no la va a ver el 95 % de las visitas.
   */
  function showFatal(err) {
    // La consola se lleva el detalle completo: la caja de la página solo
    // muestra el mensaje legible, que es lo único que va a entender quien
    // la está viendo. Quien depura necesita la traza.
    if (window.console && console.error) {
      console.error('[MetaVr] fallo de arranque\n' + ((err && err.stack) || err));
    }
    var box = document.getElementById('mv-fatal');
    if (!box) {
      box = document.createElement('div');
      box.id = 'mv-fatal';
      document.body.appendChild(box);
    }
    box.className = 'mv-fatal';
    box.innerHTML =
      '<h1>El visor no ha podido arrancar</h1>' +
      '<p>Esto no debería pasar. Si estás en un visor, prueba a recargar.</p>' +
      '<pre>' + String((err && err.message) || err) + '</pre>';
  }

  main.isRunning = function () { return running; };
  main.clock = function () { return clock; };
  main.isStandalone = isStandalone;
  main.hasWebXR = hasWebXR;
  main.runAction = runAction;

  main.stop = function () {
    running = false;
    cancelAnimationFrame(loopId);
  };

  // Autoarranque. Los scripts son `defer`, así que el DOM ya está listo.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main.start);
  } else {
    main.start();
  }

  MV.main = main;
}(window.MV = window.MV || {}));
