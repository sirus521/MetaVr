/**
 * MetaVr · showroom.
 *
 * Todas las piezas del visor con su dato, el ciclo de acabados, la vista
 * explotada y el modo "llevado".
 *
 * ── Un único modelo de interacción ────────────────────────────────────
 * No usamos cursores con raycast para los hotspots. En un Quest en
 * navegador la orientación de la mano no siempre está disponible y un rayo
 * mal orientado hace frustrar más que ayudar. En su lugar, todo
 * funciona con la misma regla que ya usa el agarre: el punto de mano
 * (que en VR pone `lasthands` y en 2D el ratón) se acerca lo suficiente y
 * se pulsa. Un solo gesto para todo, y el 2D y el VR se comportan igual.
 *
 * ── Vista explotada ───────────────────────────────────────────────────
 * Las piezas se separan con un interpolador propio en vez de `<a-animation>`.
 * Podemos encadenar,_retractar y mezclar con el modo "llevado" sin pelear
 * con A-Frame por el control de las mismas propiedades.
 */
(function (MV) {
  'use strict';

  var util = MV.util;
  var materials = MV.materials;
  var CONFIG = MV.CONFIG;
  var showroom = {};

  /* Ficha técnica. Es contenido, no configuración: por eso vive aquí y
   * no en config.js, que es solo para lo que se toca al ajustar. */
  var SPECS = [
    { k: 'Resolución por ojo', v: '2064 × 2208' },
    { k: 'Campo de visión',   v: '110°' },
    { k: 'Tasa de refresco',  v: '72 / 90 / 120 Hz' },
    { k: 'Peso',              v: '386 g' },
    { k: 'Autonomía',         v: '2 h 30' },
    { k: 'Sensores',          v: '6.DoF · manos · ojos · cara' }
  ];

  var visorEl = null;      // entidad física del visor
  var group = null;        // THREE.Group del modelo
  var camEl = null;
  var hotspots = [];
  var homeLocal = { position: group && group.position.clone(), rotation: null };

  var exploded = false;
  var explodeAmount = 0;
  var explodedTo = 0;
  var currentSpec = 0;

  var animators = [];

  /* ------------------------------------------------------------------ *
   * Interpolador
   * ------------------------------------------------------------------ */

  /**
   * Una animación muy simple: va de `from` a `to` con easing y llama a
   * `onUpdate` en cada tick. Suficiente para todo lo que necesitamos y
   * cancelable sin depender de A-Frame.
   */
  function tween(duration, onUpdate, ease) {
    var t = 0;
    var fn = ease || util.easeOutCubic;
    var api = {
      t: 0,
      cancel: function () {
        var i = animators.indexOf(api);
        if (i !== -1) { animators.splice(i, 1); }
      }
    };
    animators.push({
      t: 0,
      dt: 0,
      dur: duration,
      ease: fn,
      update: onUpdate
    });
    return api;
  }

  function stepAnimators(dt) {
    for (var i = animators.length - 1; i >= 0; i--) {
      var a = animators[i];
      a.t += dt;
      var p = a.t / a.dur;
      if (p >= 1) { p = 1; }
      a.update(a.ease(p));
      if (p >= 1) { animators.splice(i, 1); }
    }
  }

  /* ------------------------------------------------------------------ *
   * Hotspots
   * ------------------------------------------------------------------ */

  /**
   * Un hotspot es un anillo holográfico + una etiqueta. No usamos sprite
   * con `text` de canvas porque el texto se ve borroso en el visor;
   * `a-text` con la fuente por defecto se renderiza nítido a cualquier
   * distancia.
   */
  function buildHotspot(spec, meta) {
    var holder = util.entity({
      class: 'hotspot',
      position: spec.p.join(' ')
    });

    var ring = materials.holo({
      width: 0.036,
      height: 0.036,
      color: CONFIG.palette.cyan,
      opacity: 0.75,
      power: 3.2,
      speed: 1.1,
      rotation: '-90 0 0'
    });
    ring.className = 'hotspot-ring';
    holder.appendChild(ring);

    var label = document.createElement('a-text');
    label.setAttribute('value', spec.label);
    label.setAttribute('class', 'hotspot-label');
    label.setAttribute('align', 'center');
    label.setAttribute('color', CONFIG.palette.text);
    label.setAttribute('width', '0.20');
    label.setAttribute('position', '0 0.026 0');
    label.setAttribute('material', 'shader: flat; opacity: 0.92');
    holder.appendChild(label);

    // Punto central: da un blanco fácil de localizar.
    var dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.0022, 8, 6),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(CONFIG.palette.cyan) })
    );
    holder.setObject3D('punto', dot);

    holder.__mvHotspot = {
      id: spec.id,
      ring: ring,
      label: label,
      meta: meta
    };
    return holder;
  }

  /* ------------------------------------------------------------------ *
   * Vista explotada
   * ------------------------------------------------------------------ */

  /**
   * Separa las piezas. El destino de cada una viene de `meta.explode`,
   * calculado en build.js para no repetir la geometría aquí.
   */
  function applyExplode(amount) {
    explodeAmount = amount;
    var e = MV.glasses.build.meta.explode;
    for (var i = 0; i < e.length; i++) {
      var spec = e[i];
      if (!spec.target) { continue; }
      var t = spec.target;
      t.visible = true;
      t.position[spec.axis] = (spec.base || 0) + spec.distance * amount;
    }
    // Las etiquetas se ocultan al separar: tapadas quedarían flotando
    // en un sitio donde ya no está la pieza a la que apuntan.
    for (var h = 0; h < hotspots.length; h++) {
      var ring = hotspots[h].__mvHotspot.ring;
      if (ring) { ring.object3D.visible = amount < 0.6; }
    }
  }

  /* ------------------------------------------------------------------ *
   * API
   * ------------------------------------------------------------------ */

  showroom.init = function (opts) {
    visorEl = opts.visorEl;
    group = opts.group;
    camEl = opts.camEl;
    var meta = opts.meta;

    // Recordamos la posición de reposo de cada pieza: la vista explotada
    // se calcula como desplazamiento sobre ella, no como valor absoluto.
    for (var i = 0; i < meta.explode.length; i++) {
      var spec = meta.explode[i];
      if (spec.target && spec.base === undefined) {
        spec.base = spec.target.position[spec.axis];
      }
    }

    // Los hotspots cuelgan de la entidad del visor, así que viajan con él.
    for (var h = 0; h < meta.hotspots.length; h++) {
      var node = buildHotspot(meta.hotspots[h], meta);
      visorEl.appendChild(node);
      hotspots.push(node);
    }

    // Variante inicial.
    MV.materials.applyVariant(Object.keys(CONFIG.variants)[0]);

    util.log('Showroom listo con ' + hotspots.length + ' hotspots.');
    return showroom;
  };

  showroom.tick = function (dt) {
    stepAnimators(dt);
    // El estado de la mano cambia el brillo de los hotspots cercanos.
    updateHotspotGlow();
  };

  /* ------------------------------------------------------------------ *
   * Interacción
   * ------------------------------------------------------------------ */

  /**
   * ¿Qué hotspot hay bajo la mano? Devuelve el elemento o null.
   * Misma tolerancia que el agarre para que la sensación sea uniforme.
   */
  showroom.hotspotUnderHand = function () {
    var hand = MV.stage && MV.stage.handObject ? MV.stage.handObject() : null;
    if (!hand) { return null; }
    var p = hand.getWorldPosition(new THREE.Vector3());
    var best = null, bestD = 0.10;   // 10 cm
    for (var i = 0; i < hotspots.length; i++) {
      var el = hotspots[i];
      if (!el.object3D.visible) { continue; }
      var wp = el.object3D.getWorldPosition(new THREE.Vector3());
      var d = wp.distanceTo(p);
      if (d < bestD) { bestD = d; best = el; }
    }
    return best;
  };

  /**
   * El hotspot bajo la mano brilla más que el resto. Se escribe con el
   * setAttribute de tres argumentos, que toca una sola propiedad del
   * componente y deja el resto del material (shader, color, blending) como
   * estaba. Pasando una cadena entera se pisarían los demás campos con sus
   * valores por defecto.
   */
  function updateHotspotGlow() {
    var near = showroom.hotspotUnderHand();
    for (var i = 0; i < hotspots.length; i++) {
      var hs = hotspots[i].__mvHotspot;
      var on = hotspots[i] === near;
      hs.ring.setAttribute('material', 'opacity', on ? 1.0 : 0.75);
      hs.label.setAttribute('material', 'opacity', on ? 1 : 0.55);
    }
  }

  /**
   * Activa un hotspot por id. Lo llama el HUD, el puntero 2D y el easter
   * egg del visor, así que es idempotente.
   */
  showroom.activate = function (id) {
    if (id === 'cristal') { showroom.toggleOptical(); return; }
    if (id === 'patilla') { showroom.setWorn(!MV.optical.isWorn()); return; }
    if (id === 'puente') { showroom.cycleVariant(); return; }
    if (id === 'sensor' || id === 'canal') {
      // Sensor y canal no cambian el modelo: enseñan la ficha técnica.
      // El HUD decide si la pinta en 3D o en el overlay de 2D.
      document.dispatchEvent(new CustomEvent('mv:spec', {
        detail: { id: id, specs: SPECS }
      }));
      return;
    }
    util.warnOnce('hotspot:' + id, 'Hotspot sin acción: ' + id);
  };

  /* ------------------------------------------------------------------ *
   * Acciones
   * ------------------------------------------------------------------ */

  showroom.toggleOptical = function () {
    var on = !MV.optical.isEnabled();
    MV.optical.setEnabled(on);
    document.dispatchEvent(new CustomEvent('mv:optical', { detail: { on: on } }));
    MV.quip.say(on ? 'filterOn' : 'filterOff');
    return on;
  };

  showroom.cycleVariant = function () {
    var key = MV.materials.nextVariant();
    var v = CONFIG.variants[key];
    document.dispatchEvent(new CustomEvent('mv:variant', {
      detail: { key: key, label: v.label }
    }));
    MV.quip.say('variant');
    return key;
  };

  /**
   * Ponerse las gafas.
   *
   * Here es donde está el único punto delicado del proyecto: la entidad
   * `visor` tiene cuerpo dinámico, y si movemos su objeto 3D a mano la
   * física lo devuelve a su sitio en el siguiente paso. Solución: poner el
   * cuerpo en `static` mientras están puestas (en static, cannon lee la
   * posición del objeto en vez de escribirla) y reparentar el modelo bajo
   * la cámara. Al quitarlas, al revés.
   */
  showroom.setWorn = function (worn) {
    if (worn === MV.optical.isWorn()) { return worn; }

    if (worn) {
      // Guardamos dónde estaba el modelo para devolverlo exacto.
      homeLocal.position = group.position.clone();
      homeLocal.rotation = group.rotation.clone();

      visorEl.setAttribute('body', { type: 'static' });
      camEl.object3D.add(group);
      group.position.set(0, -0.022, -0.085);
      group.rotation.set(util.rad(-6), 0, 0);
      group.scale.setScalar(0.92);
      // Los hotspots se quedan en el visor, que sigue en la mesa.
      setHotspotsVisible(false);
    } else {
      visorEl.object3D.add(group);
      group.position.copy(homeLocal.position);
      group.rotation.copy(homeLocal.rotation);
      group.scale.setScalar(1);
      visorEl.setAttribute('body', { type: 'dynamic' });
      // El cuerpo estaba en static, así que su posición quedó atrás.
      MV.physics.respawnGlasses();
      setHotspotsVisible(true);
    }

    MV.optical.setWorn(worn);
    document.dispatchEvent(new CustomEvent('mv:worn', { detail: { worn: worn } }));
    MV.quip.say(worn ? 'wear' : 'unwear');
    return worn;
  };

  function setHotspotsVisible(v) {
    for (var i = 0; i < hotspots.length; i++) {
      hotspots[i].object3D.visible = v;
    }
  }

  /** La vista explotada no tiene sentido con las gafas puestas. */
  showroom.toggleExplode = function (force) {
    if (MV.optical.isWorn() && force !== true) {
      MV.quip.say('flat');
      return false;
    }
    explodedTo = (force !== undefined) ? (force ? 1 : 0) : (explodedTo ? 0 : 1);
    var from = explodeAmount, to = explodedTo, dur = 0.75;
    tween(dur, function (p) { applyExplode(util.lerp(from, to, p)); });
    exploded = !!explodedTo;
    return exploded;
  };

  showroom.isExploded = function () { return exploded; };

  /** Ficha técnica: el visor la muestra, el HUD 2D también. */
  showroom.specs = function () { return SPECS; };

  /** Contador para el easter egg de "ver todo". */
  showroom.visited = function () {
    var n = 0;
    for (var i = 0; i < hotspots.length; i++) {
      if (hotspots[i].__mvHotspot.seen) { n += 1; }
    }
    return n;
  };

  showroom.total = function () { return hotspots.length; };

  showroom.markSeen = function (el) {
    if (el && el.__mvHotspot) { el.__mvHotspot.seen = true; }
  };

  showroom.dispose = function () {
    animators.length = 0;
    for (var i = 0; i < hotspots.length; i++) {
      if (hotspots[i].parentNode) { hotspots[i].parentNode.removeChild(hotspots[i]); }
    }
    hotspots.length = 0;
    visorEl = null; group = null; camEl = null;
  };

  MV.showroom = showroom;
}(window.MV = window.MV || {}));
