/**
 * MetaVr · huevos de pascua.
 *
 * Todos están agrupados aquí, en un solo sitio, porque dispersos por el
 * código son imposibles de quitar después.
 *
 * Regla de la casa: un easter egg nunca rompe la experiencia. Si uno falla,
 * se avisa una vez por consola y el resto de la página sigue. Nada de
 * `throw` en un evento.
 *
 * Los tres grandes:
 *   · Konami → el visor confiesa que sabe lo que estás haciendo.
 *   · Todos los hotspots vistos → AURA-9 confiesa que los lleva todos.
 *   · Mirar al visor 4 segundos → te dice que te ha visto.
 */
(function (MV) {
  'use strict';

  var util = MV.util;
  var easter = {};

  var KONAMI = [
    'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
    'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'
  ];

  var progress = [];
  var found = {};        // id → true, para no repetir el efecto
  var lookTime = 0;
  var idleNudges = 0;
  var confetti = [];

  /* ------------------------------------------------------------------ *
   * Utilidad: celebrar
   * ------------------------------------------------------------------ */

  /**
   * Confeti. Un `THREE.Points` con 60 partículas y un update en CPU: es
   * exactamente lo que se pide aquí (algo que caiga) y cuesta una llamada
   * de dibujo. Un sistema de partículas de verdad no compensaría.
   */
  function celebrate() {
    var N = 60;
    var pos = new Float32Array(N * 3);
    var vel = [];
    var origin = new THREE.Vector3(0, MV.CONFIG.scene.pedestalY + 0.12, MV.CONFIG.scene.pedestalZ);

    for (var i = 0; i < N; i++) {
      pos[i * 3] = origin.x;
      pos[i * 3 + 1] = origin.y;
      pos[i * 3 + 2] = origin.z;
      vel.push(new THREE.Vector3(
        util.rand(-0.6, 0.6), util.rand(0.3, 1.1), util.rand(-0.6, 0.6)
      ));
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var mat = new THREE.PointsMaterial({
      color: new THREE.Color(MV.CONFIG.palette.cyan),
      size: 0.006,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var points = new THREE.Points(geo, mat);
    points.name = 'confeti';
    MV.stage.el.object3D.add(points);
    confetti.push({ obj: points, vel: vel, life: 0, attr: geo.attributes.position });
  }

  function stepConfetti(dt) {
    for (var i = confetti.length - 1; i >= 0; i--) {
      var c = confetti[i];
      c.life += dt;
      var arr = c.attr.array;
      for (var p = 0; p < c.vel.length; p++) {
        var v = c.vel[p];
        v.y -= 2.4 * dt;            // gravedad propia: más suave que la real
        arr[p * 3] += v.x * dt;
        arr[p * 3 + 1] += v.y * dt;
        arr[p * 3 + 2] += v.z * dt;
      }
      c.attr.needsUpdate = true;
      c.obj.material.opacity = Math.max(0, 1 - c.life / 2.2);
      if (c.life > 2.2) {
        MV.stage.el.object3D.remove(c.obj);
        c.obj.geometry.dispose();
        c.obj.material.dispose();
        confetti.splice(i, 1);
      }
    }
  }

  /**
   * Marca un huevo como encontrado y devuelve si es la primera vez.
   * Todo el celebratorio pasa por aquí para que "solo una vez" no
   * dependa de que cada llamador se acuerde de comprobarlo.
   */
  function mark(id) {
    if (found[id]) { return false; }
    found[id] = true;
    return true;
  }

  /* ------------------------------------------------------------------ *
   * Konami
   * ------------------------------------------------------------------ */

  function onKey(e) {
    var k = e.key;
    progress.push(k.length === 1 ? k.toLowerCase() : k);
    if (progress.length > KONAMI.length) { progress.shift(); }
    if (progress.length !== KONAMI.length) { return; }

    var match = true;
    for (var i = 0; i < KONAMI.length; i++) {
      var want = KONAMI[i].length === 1 ? KONAMI[i].toLowerCase() : KONAMI[i];
      if (progress[i] !== want) { match = false; break; }
    }
    if (!match) { return; }

    progress.length = 0;
    if (!mark('konami')) { return; }
    celebrate();
    MV.quip.say('secret');
    util.log('Konami. Nice.');
  }

  /* ------------------------------------------------------------------ *
   * Los otros
   * ------------------------------------------------------------------ */

  /** Todos los hotspots vistos. */
  function checkShowroom() {
    if (!MV.showroom) { return; }
    if (MV.showroom.visited() < MV.showroom.total()) { return; }
    // Con el 100 % alcanzado, volver a pulsar cualquier hotspot volvería a
    // pasar por aquí. Solo se celebra la primera vez.
    if (!mark('showroom')) { return; }
    celebrate();
    MV.quip.say('secret');
  }

  /**
   * El visor te está mirando. Se activa con las gafas puestas: en XR la
   * cámara ya es tu cabeza, así que llevándolas puestas el tiempo es la
   * mirada. En 2D no hay cara detrás, pero el gesto sigue leyéndose.
   */
  function checkEyeContact(dt) {
    var worn = MV.optical && MV.optical.isWorn();
    var cam = MV.stage && MV.stage.camera;

    if (!worn || !cam) { lookTime = 0; return; }

    lookTime += dt;
    if (lookTime >= 4 && mark('eyec')) {
      celebrate();
      MV.quip.say('secret');
    }
  }

  /** Nadie ha tocado nada en un rato: el visor se aburre y avisa. */
  function checkIdle(idleSeconds) {
    if (idleSeconds < 45) { return; }
    if (idleNudges >= 2) { return; }
    idleNudges += 1;
    MV.quip.say('idle');
  }

  /* ------------------------------------------------------------------ *
   * API
   * ------------------------------------------------------------------ */

  easter.init = function () {
    window.addEventListener('keydown', onKey);
    MV.quip.reset();
    util.log('Easter eggs armed.');
    return easter;
  };

  easter.tick = function (dt, idleSeconds) {
    stepConfetti(dt);
    checkEyeContact(dt);
    checkIdle(idleSeconds || 0);
  };

  /** Se llama desde el HUD cada vez que se activa un hotspot. */
  easter.hotspotSeen = function (el) {
    if (!MV.showroom) { return; }
    MV.showroom.markSeen(el);
    checkShowroom();
  };

  easter.isFound = function (id) { return !!found[id]; };
  easter.count = function () { return Object.keys(found).length; };

  easter.dispose = function () {
    window.removeEventListener('keydown', onKey);
    for (var i = 0; i < confetti.length; i++) {
      var c = confetti[i];
      c.obj.geometry.dispose();
      c.obj.material.dispose();
    }
    confetti.length = 0;
    progress.length = 0;
  };

  MV.easter = easter;
}(window.MV = window.MV || {}));
