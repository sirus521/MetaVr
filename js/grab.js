/**
 * MetaVr · agarre físico.
 *
 * ── Cómo funciona ─────────────────────────────────────────────────────
 * 1. Al pulsar, buscamos el agarrable más cercano al punto de mano dentro
 *    de un radio corto. Sin raycast: en el navegador del Quest la
 *    orientación de la mano no siempre está disponible, y acertar con un
 *    rayo de 2 mm a 40 cm es agotador.
 * 2. Un cuerpo KINEMATIC en el punto de mano hace de ancla. En cannon un
 *    cuerpo cinemático no se integra ni colisiona, pero su velocidad sí la
 *    ve el solucionador: por eso soltar mientras mueves la mano lanza la
 *    bola en esa dirección.
 * 3. Un CANNON.LockConstraint une ancla y objeto. No es una unión libre:
 *    además de impedir que se separen, bloquea la rotación relativa, así
 *    que la bola no gira de-spin en la mano mientras la mueves.
 * 4. `maxForce` acota la restricción para que un salto de la cámara no
 *    arrastre la bola a través del suelo.
 * 5. Al soltar quitamos la restricción y topamos la velocidad: cannon-es
 *    no tiene detección continua, así que una bola a 30 m/s atraviesa el
 *    colisionador sin que nadie se entere.
 *
 * ── Un solo ancla ─────────────────────────────────────────────────────
 * El cuerpo cinemático se crea una vez y se reutiliza. Crear y destruir
 * cuerpos dentro del bucle de física es de las cosas que más problemas dan
 * cuando ocurre 120 veces por minuto.
 *
 * ── Ratón y mando, mismo camino ───────────────────────────────────────
 * El punto de mano lo escribe `lasthands` en VR y el ratón en 2D. Aquí solo
 * se consume, así que el resto de la página no distingue entre los dos.
 */
(function (MV) {
  'use strict';

  var util = MV.util;
  var CONFIG = MV.CONFIG;
  var grab = {};

  var system = null;
  var sceneEl = null;
  var hand = null;          // THREE.Object3D del punto de mano

  var anchor = null;        // CANNON.Body cinemático reutilizable
  var active = null;        // { el, body, constraint }
  var grabbables = [];
  var handVel = new THREE.Vector3();
  var lastHandPos = new THREE.Vector3();
  var hasLastPos = false;
  var enabled = false;

  var PICK_RADIUS = 0.14;   // 14 cm de tolerancia al elegir agarrable

  /* ------------------------------------------------------------------ *
   * Registro de agarrables
   * ------------------------------------------------------------------ */

  grab.register = function (el, opts) {
    var o = opts || {};
    if (!el || grabbables.indexOf(el) !== -1) { return; }
    el.__mvGrabbable = o.canGrab !== false;
    grabbables.push(el);
  };

  grab.unregister = function (el) {
    var i = grabbables.indexOf(el);
    if (i !== -1) { grabbables.splice(i, 1); }
    if (active && active.el === el) { grab.release(); }
  };

  grab.count = function () { return grabbables.length; };
  grab.isGrabbing = function () { return !!active; };
  grab.grabbedEl = function () { return active ? active.el : null; };

  /** Posición en el mundo de lo que tenemos en la mano, para el HUD. */
  grab.heldPosition = function () {
    if (!active) { return null; }
    return new THREE.Vector3(
      active.body.position.x, active.body.position.y, active.body.position.z
    );
  };

  /* ------------------------------------------------------------------ *
   * Ancla cinemática
   * ------------------------------------------------------------------ */

  function makeAnchor() {
    var body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.KINEMATIC,
      position: new CANNON.Vec3(0, 0, 0)
    });
    // `system.addBody` deja un listener de `collide` que hace
    // `body.el.emit(...)`. Un cuerpo cinemático sin forma no genera
    // contactos, así que ese listener nunca debería dispararse; pero si se
    // disparara con `el` undefined reventaría la escena. Le damos un
    // destinatario que se traga el evento sin propagarlo a ninguna parte.
    body.el = {
      emit: function () {},
      object3D: null
    };
    return body;
  }

  /* ------------------------------------------------------------------ *
   * Elección de objeto
   * ------------------------------------------------------------------ */

  function pickNearest(point) {
    var best = null;
    var bestD = PICK_RADIUS;
    for (var i = 0; i < grabbables.length; i++) {
      var el = grabbables[i];
      if (!el.__mvGrabbable || !el.object3D || !el.object3D.visible) { continue; }
      var c = el.object3D.getWorldPosition(new THREE.Vector3());
      var d = c.distanceTo(point);
      if (d < bestD) { bestD = d; best = el; }
    }
    return best;
  }

  /**
   * Raycast para el ratón. Se usa solo cuando hay varios agarrables
   * amontonados: el centro del más cercano gana, pero si hay dos a la vez
   * el rayo dice cuál tienes delante de verdad.
   */
  function pickFromScreen(clientX, clientY) {
    if (!sceneEl || !sceneEl.camera) { return null; }
    var cam = sceneEl.camera;
    var ndc = util.screenToNdc(clientX, clientY, sceneEl);
    if (!ndc) { return null; }

    // Sin esto el primer clic tras mover la cámara dispara con la matriz
    // del frame anterior.
    cam.updateMatrixWorld();
    var ray = new THREE.Raycaster();
    ray.ray.origin.setFromMatrixPosition(cam.matrixWorld);
    ray.ray.direction.set(ndc.x, ndc.y, 0.5).unproject(cam)
      .sub(ray.ray.origin).normalize();

    var meshes = [];
    for (var i = 0; i < grabbables.length; i++) {
      var el = grabbables[i];
      if (!el.__mvGrabbable || !el.object3D || !el.object3D.visible) { continue; }
      el.object3D.traverse(function (o) {
        if (o.isMesh && o.visible) { meshes.push(o); }
      });
    }
    if (!meshes.length) { return null; }

    var hits = ray.intersectObjects(meshes, false);
    if (!hits.length) { return null; }
    // Del mesh al ancestro registrado.
    var node = hits[0].object;
    while (node) {
      if (grabbables.indexOf(node) !== -1) { return node; }
      node = node.parent;
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * API
   * ------------------------------------------------------------------ */

  /**
   * @param {HTMLElement} el   la escena
   * @param {THREE.Object3D} handObject  punto de mano (el que escribe
   *        `lasthands` en VR y el ratón en 2D)
   */
  grab.init = function (el, handObject) {
    sceneEl = el;
    hand = handObject;
    system = el.systems.physics;

    if (!system) {
      util.warnOnce('grab', 'Sin sistema de física: el agarre queda desactivado.');
      return false;
    }
    if (!hand) {
      util.warnOnce('grab', 'Sin punto de mano: el agarre queda desactivado.');
      return false;
    }

    try {
      anchor = makeAnchor();
      // addBody del sistema, no world.addBody: el sistema es quien enlaza
      // los métodos del body al driver y quien gestiona los listeners.
      system.addBody(anchor);
    } catch (err) {
      anchor = null;
      util.warnOnce('grab-body',
        'No se pudo crear el ancla de agarre; el visor no se podrá mover.', err);
      return false;
    }

    el.addEventListener('gripdown', onSelectStart);
    el.addEventListener('trackpaddown', onSelectStart);
    el.addEventListener('triggerdown', onSelectStart);
    el.addEventListener('gripup', onSelectEnd);
    el.addEventListener('trackpadup', onSelectEnd);
    el.addEventListener('triggerup', onSelectEnd);

    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onSelectEnd);
    el.addEventListener('touchend', onSelectEnd);

    enabled = true;
    util.log('Agarre listo. Coge una bola y suéltala para lanzarla.');
    return true;
  };

  function onSelectStart() {
    if (!enabled) { return; }
    var point = hand.getWorldPosition(new THREE.Vector3());
    var el = pickNearest(point);
    if (el) { grab.grab(el); }
  }

  function onMouseDown(e) {
    if (!enabled) { return; }
    // Primero el rayo (dice qué tienes delante), luego la distancia
    // (agarra lo que el usuario quiso decir).
    var hit = pickFromScreen(e.clientX, e.clientY);
    if (hit) { grab.grab(hit); return; }
    onSelectStart();
  }

  function onSelectEnd() {
    if (active) { grab.release(); }
  }

  /**
   * Coge un objeto. Si ya había otro en la mano, lo suelta antes: es lo
   * que espera cualquiera que intente cambiar de bola.
   */
  grab.grab = function (el) {
    if (!enabled || !anchor || !el || !el.body) { return false; }
    if (active) { grab.release(); }

    var body = el.body;
    var handPos = hand.getWorldPosition(new THREE.Vector3());

    // Ponemos el ancla donde está la mano y nos guardamos el desplazamiento
    // hasta el objeto, para no teletransportarlo al engancharlo.
    anchor.position.set(handPos.x, handPos.y, handPos.z);
    anchor.velocity.set(0, 0, 0);
    handVel.set(0, 0, 0);
    lastHandPos.copy(handPos);
    hasLastPos = true;

    var offset = new CANNON.Vec3(
      body.position.x - handPos.x,
      body.position.y - handPos.y,
      body.position.z - handPos.z
    );

    var c = new CANNON.LockConstraint(anchor, body, {
      maxForce: CONFIG.physics.grabMaxForce
    });
    system.addConstraint(c);
    body.wakeUp();

    active = { el: el, body: body, constraint: c, offset: offset };
    el.emit('mv:grabbed', {});
    el.classList.add('is-held');
    return true;
  };

  grab.release = function () {
    if (!active) { return; }
    system.removeConstraint(active.constraint);

    var b = active.body;
    b.wakeUp();

    // Tope de velocidad: sin CCD, esto es lo que evita que una bola
    // atraviese el visor o el suelo.
    var max = CONFIG.physics.maxThrowSpeed;
    var v = b.velocity;
    var speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    var reported = Math.min(speed, max);
    if (speed > max) {
      var k = max / speed;
      v.x *= k; v.y *= k; v.z *= k;
    }

    var el = active.el;
    active = null;
    if (el) {
      el.classList.remove('is-held');
      el.emit('mv:released', { speed: reported });
    }
    return reported;
  };

  /**
   * Mueve el ancla con la mano. Se llama en cada tick del bucle global,
   * antes de que la física dé su paso.
   */
  grab.tick = function (dt) {
    if (!anchor || !hand) { return; }
    var pos = hand.getWorldPosition(new THREE.Vector3());

    if (!hasLastPos) {
      lastHandPos.copy(pos);
      hasLastPos = true;
    }
    // Velocidad de la mano, acotada. Es lo que convierte "soltar mientras
    // mueves" en un lanzamiento con dirección en vez de un soltón.
    handVel.copy(pos).sub(lastHandPos).divideScalar(Math.max(dt, 0.0001));
    handVel.clampLength(0, CONFIG.physics.maxThrowSpeed * 1.5);
    lastHandPos.copy(pos);

    anchor.position.set(pos.x, pos.y, pos.z);
    // Solo cuando hay algo en la mano. Con la ancla quieta y sin
    // restricción no hay a quién empujar, pero actualizarla cada frame es
    // trabajo gratis que no aporta nada.
    if (active) {
      anchor.velocity.set(handVel.x, handVel.y, handVel.z);
    }
  };

  grab.dispose = function () {
    if (active) { grab.release(); }
    if (system && anchor) { system.removeBody(anchor); }
    anchor = null;
    if (sceneEl) {
      ['gripdown', 'trackpaddown', 'triggerdown',
       'gripup', 'trackpadup', 'triggerup', 'mousedown', 'touchend'
      ].forEach(function (ev) { sceneEl.removeEventListener(ev, ev === 'mousedown' ? onMouseDown : ev.indexOf('down') > -1 ? onSelectStart : onSelectEnd); });
    }
    window.removeEventListener('mouseup', onSelectEnd);
    grabbables.length = 0;
    sceneEl = null; system = null; hand = null; active = null;
  };

  MV.grab = grab;
}(window.MV = window.MV || {}));
