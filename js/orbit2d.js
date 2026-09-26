/**
 * MetaVr · control de cámara para el modo 2D.
 *
 * Un orbit propio en lugar de THREE.OrbitControls. Dos motivos:
 *   · A-Frame 1.8.0 no incluye OrbitControls en su build, así que o
 *     cargo otro fichero de examples/js o escribo 90 líneas. Escritas.
 *   · Necesito que se deshabilite solo al entrar en VR y que acepte un
 *     objetivo animado (el easter egg de enfoque), cosas que con el
 *     componente estándar hay que pelear.
 *
 * Este control solo mueve la cámara: el picking y el agarre viven en
 * grab.js. El gesto se reparte solo: el canvas solo recibe el arrastre que
 * empieza sobre el propio canvas, así que si el usuario empieza a tirar
 * de una bola no estamos orbitando a la vez.
 */
(function (MV) {
  'use strict';

  var util = MV.util;
  var orbit = {};

  var cam = null;          // THREE.Object3D de la cámara
  var target = null;       // THREE.Vector3
  var dom = null;          // canvas
  var enabled = true;

  var spherical = { radius: 1.6, theta: 0, phi: Math.PI / 2.2 };
  var sphericalGoal = null;
  var focus = null;        // objetivo de enfoque animado
  var limits = {};
  var home = null;         // vista inicial, para el reset

  var dragging = false;
  var lastX = 0, lastY = 0;
  var moved = 0;           // px recorridos: distingue clic de arrastre

  /* ------------------------------------------------------------------ *
   * Aplicación del estado
   * ------------------------------------------------------------------ */

  function apply() {
    var sp = Math.sin(spherical.phi);
    cam.position.set(
      target.x + spherical.radius * sp * Math.sin(spherical.theta),
      target.y + spherical.radius * Math.cos(spherical.phi),
      target.z + spherical.radius * sp * Math.cos(spherical.theta)
    );
    cam.lookAt(target);
  }

  /* ------------------------------------------------------------------ *
   * Entrada
   * ------------------------------------------------------------------ */

  function onDown(e) {
    if (!enabled) { return; }
    // Clic izquierdo solo, y sin captura cuando el gesto empezó sobre un
    // objeto agarrable: ahí manda el agarre.
    if (e.button !== 0) { return; }
    if (e.target !== dom) { return; }
    dragging = true;
    moved = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    focus = null;   // el usuario manda: se cancela el enfoque automático
    dom.style.cursor = 'grabbing';
  }

  function onMove(e) {
    if (!dragging || !enabled) { return; }
    var dx = e.clientX - lastX;
    var dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);

    var s = sphericalGoal;
    s.theta -= dx * 0.006;
    // phi se limita para no pasar por encima ni por debajo de la mesa.
    s.phi = util.clamp(s.phi - dy * 0.005, limits.minPhi, limits.maxPhi);
  }

  function onUp() {
    if (!dragging) { return; }
    dragging = false;
    dom.style.cursor = '';
  }

  function onWheel(e) {
    if (!enabled) { return; }
    e.preventDefault();
    focus = null;
    // Zoom exponencial: el lineal se nota mucho al principio y nada al final.
    sphericalGoal.radius = util.clamp(
      sphericalGoal.radius * (1 + Math.sign(e.deltaY) * 0.12),
      limits.minRadius, limits.maxRadius
    );
  }

  /** Flechas para mover la mano, WASD para orbitar. Sube los 12 pasos. */
  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) { return; }
    var k = e.key;
    var step = 0.06;

    if (k === 'ArrowLeft')  { sphericalGoal.theta += step; }
    else if (k === 'ArrowRight') { sphericalGoal.theta -= step; }
    else if (k === 'ArrowUp')    { sphericalGoal.phi = util.clamp(sphericalGoal.phi - step, limits.minPhi, limits.maxPhi); }
    else if (k === 'ArrowDown')  { sphericalGoal.phi = util.clamp(sphericalGoal.phi + step, limits.minPhi, limits.maxPhi); }
    else if (k === 'w' || k === 'W') { sphericalGoal.radius = util.clamp(sphericalGoal.radius - step, limits.minRadius, limits.maxRadius); }
    else if (k === 's' || k === 'S') { sphericalGoal.radius = util.clamp(sphericalGoal.radius + step, limits.minRadius, limits.maxRadius); }
    else { return; }

    focus = null;
    e.preventDefault();
  }

  /* ------------------------------------------------------------------ *
   * API
   * ------------------------------------------------------------------ */

  /**
   * @param {object} opts {camera, target: Vector3, dom, radius, theta, phi,
   *                       minRadius, maxRadius, minPhi, maxPhi}
   */
  orbit.init = function (opts) {
    cam = opts.camera;
    target = (opts.target || new THREE.Vector3()).clone();

    // El canvas de A-Frame es la superficie de entrada real: el `wheel` y
    // el `pointerdown` tienen que venir de ahí, no del window.
    dom = opts.dom || (MV.stage && MV.stage.el ? MV.stage.el.canvas : null);
    if (!dom) {
      util.warnOnce('orbit', 'Sin canvas: el modo 2D no tendrá cámara.');
      return false;
    }

    limits = {
      minRadius: util.clamp(opts.minRadius || 0.42, 0.2, 3),
      maxRadius: util.clamp(opts.maxRadius || 3.2, 0.5, 8),
      minPhi: opts.minPhi !== undefined ? opts.minPhi : util.rad(16),
      maxPhi: opts.maxPhi !== undefined ? opts.maxPhi : util.rad(96)
    };

    spherical.radius = util.clamp(
      opts.radius || 1.6, limits.minRadius, limits.maxRadius);
    spherical.theta = opts.theta || 0;
    spherical.phi = util.clamp(
      opts.phi || util.rad(72), limits.minPhi, limits.maxPhi);
    sphericalGoal = {
      radius: spherical.radius,
      theta: spherical.theta,
      phi: spherical.phi
    };

    dom.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    dom.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);

    home = {
      radius: spherical.radius,
      theta: spherical.theta,
      phi: spherical.phi
    };
    apply();
    util.log('Cámara 2D lista. Arrastra para orbitar, rueda para acercar.');
    return true;
  };

  /**
   * Movimiento amortiguado. Con damping exponencial el frame rate no
   * importa, cosa que en un Quest importa muchísimo.
   */
  orbit.tick = function (dt) {
    if (!cam) { return; }

    if (focus) {
      // Enfoque animado: se acerca el objetivo y se recalcula el radio.
      target.lerp(focus.target, 1 - Math.pow(0.001, dt));
      var d = cam.position.distanceTo(target);
      sphericalGoal.radius = util.clamp(
        util.damp(d, cam.position.distanceTo(focus.position), 90, dt),
        limits.minRadius, limits.maxRadius);
      if (target.distanceTo(focus.target) < 0.004) { focus = null; }
    }

    if (enabled) {
      var k = 1 - Math.pow(0.0008, dt);
      spherical.radius = util.lerp(spherical.radius, sphericalGoal.radius, k);
      spherical.theta = util.lerp(spherical.theta, sphericalGoal.theta, k);
      spherical.phi = util.lerp(spherical.phi, sphericalGoal.phi, k);
    }
    apply();
  };

  /**
   * Enfoque animado hacia un punto. Lo llama el easter egg de "mírame"
   * y el botón de "ver detalle" del HUD.
   */
  orbit.focusOn = function (newTarget, newPosition) {
    focus = { target: newTarget.clone(), position: newPosition.clone() };
  };

  orbit.setEnabled = function (v) { enabled = !!v; };
  orbit.isEnabled = function () { return enabled; };
  orbit.isDragging = function () { return dragging; };
  orbit.movedEnough = function (px) { return moved > (px || 6); };
  orbit.target = function () { return target; };
  orbit.radius = function () { return spherical.radius; };

  /** Vuelve a la vista inicial: la que se ve al abrir la página. */
  orbit.reset = function () {
    focus = null;
    sphericalGoal.radius = home.radius;
    sphericalGoal.theta = home.theta;
    sphericalGoal.phi = home.phi;
  };
  orbit.zoom = function (f) {
    focus = null;
    sphericalGoal.radius = util.clamp(
      sphericalGoal.radius * f, limits.minRadius, limits.maxRadius);
  };
  orbit.dispose = function () {
    if (dom) {
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('wheel', onWheel);
      dom.style.cursor = '';
    }
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('keydown', onKey);
    cam = null; dom = null; sphericalGoal = null; focus = null;
  };

  MV.orbit = orbit;
}(window.MV = window.MV || {}));
