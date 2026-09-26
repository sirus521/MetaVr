/**
 * MetaVr · HUD tridimensional.
 *
 * Todo lo que el usuario necesita tocar dentro de la sesión de VR vive en
 * el mundo, no en el DOM: en un visor no hay ratón y un div es invisible.
 * Así que el HUD son planos holográficos con `a-text` encima.
 *
 * ── Por qué botones físicos y no cursor con raycast ───────────────────
 * Mismo motivo que en el showroom: la orientación de la mano no siempre
 * está disponible en el navegador del Quest, y acertar con un rayo de
 * 2 mm de largo a 40 cm es agotador. Pulsar con la mano "encima" del botón
 * funciona igual de bien y se parece más a usar un objeto físico.
 *
 * ── Por qué `a-text` y no texto en canvas ─────────────────────────────
 * `a-text` se renderiza con la fuente de la escena, nítida a cualquier
 * distancia. Un sprite de canvas se ve borroso justo cuando el usuario se
 * acerca a leer, que es cuando lo lee.
 */
(function (MV) {
  'use strict';

  var util = MV.util;
  var CONFIG = MV.CONFIG;
  var ui3d = {};

  var root = null;         // entidad contenedor
  var speech = null;       // { panel, text, plane }
  var specPanel = null;
  var scorePanel = null;
  var buttons = [];
  var pressAnim = [];
  var quipTimer = 0;
  var visible = true;

  /* ------------------------------------------------------------------ *
   * Texto
   * ------------------------------------------------------------------ */

  /**
   * A-Frame envuelve el texto solo por palabras cuando la entidad tiene
   * `width`, con `wrapCount` como número de caracteres equivalente. No
   * hace falta partir las líneas a mano, que además se rompería en
   * cuanto alguien cambie la fuente.
   */

  /* ------------------------------------------------------------------ *
   * Piezas
   * ------------------------------------------------------------------ */

  function makeText(attrs) {
    var t = document.createElement('a-text');
    Object.keys(attrs).forEach(function (k) { t.setAttribute(k, attrs[k]); });
    return t;
  }

  /**
   * Fondo holográfico. `mv-holo` con `power` alto da un degradado radial
   * suave; con `power` bajo, un bloque casi uniforme. Los paneles usan
   * potencia baja y el suelo usa potencia alta.
   */
  function makePanel(worldW, worldH, color, opacity, power) {
    return MV.materials.holo({
      width: worldW,
      height: worldH,
      color: color || CONFIG.palette.cyan,
      opacity: opacity !== undefined ? opacity : 0.22,
      power: power !== undefined ? power : 1.1,
      speed: 0.5,
      depthTest: false
    });
  }

  /* ------------------------------------------------------------------ *
   * Bocadillo de réplicas
   * ------------------------------------------------------------------ */

  function buildSpeech() {
    var holder = util.entity({ id: 'replica' });
    var W = 0.52, H = 0.13;

    var plane = makePanel(W, H, CONFIG.palette.cyan, 0.20, 1.0);
    holder.appendChild(plane);

    var text = makeText({
      value: '...',
      align: 'center',
      color: CONFIG.palette.text,
      width: W - 0.04,
      position: '0 0 ' + 0.002,
      'material': 'shader: flat; opacity: 0.95; transparent: true',
      'side': 'front'
    });
    holder.appendChild(text);

    // Posición: por encima del panel de control, mirando al usuario.
    holder.setAttribute('position',
      '0 ' + (CONFIG.scene.hudY + 0.20) + ' ' + CONFIG.scene.hudZ);

    return { holder: holder, plane: plane, text: text, W: W, H: H };
  }

  /**
   * Muestra una réplica. El texto se parte en líneas y se centra.
   * Al vaciarse, la réplica anterior se queda un momento y se desvanece.
   */
  function setQuip(text) {
    if (!speech) { return; }
    speech.text.setAttribute('value', text);
    // Las réplicas largas necesitan más de dos líneas: con wrapCount
    // pequeño el texto se parte antes de que se salga del panel.
    speech.text.setAttribute('wrapCount', 34);
    // Reiniciamos el temporizador de "quedarse quieto".
    quipTimer = 4.2;
  }

  /* ------------------------------------------------------------------ *
   * Botones
   * ------------------------------------------------------------------ */

  var BUTTONS = [
    { id: 'optical', label: 'FILTRO' },
    { id: 'variant', label: 'ACABADO' },
    { id: 'explode', label: 'VISTA' },
    { id: 'wear',   label: 'PONER' },
    { id: 'game',   label: 'JUEGO' }
  ];

  function buildButtons() {
    var holder = util.entity({
      id: 'panel-botones',
      position: '0 ' + CONFIG.scene.hudY + ' ' + CONFIG.scene.hudZ,
      rotation: '-28 0 0'
    });

    var n = BUTTONS.length;
    var gap = 0.115;
    var totalW = gap * (n - 1);
    // Ancho del panel: un poco de margen a los lados sobre los botones.
    var panelW = totalW + 0.10;

    var plate = makePanel(panelW, 0.085, CONFIG.palette.cyan, 0.14, 0.9);
    plate.setAttribute('position', '0 0 -0.004');
    holder.appendChild(plate);

    BUTTONS.forEach(function (b, i) {
      var btn = util.entity({
        id: 'btn-' + b.id,
        class: 'mv-button',
        position: ((i - (n - 1) / 2) * gap) + ' 0 0'
      });

      var face = makePanel(0.098, 0.062, CONFIG.palette.cyan, 0.30, 1.4);
      btn.appendChild(face);

      var label = makeText({
        value: b.label,
        align: 'center',
        color: CONFIG.palette.text,
        width: 0.092,
        position: '0 0 0.002',
        'material': 'shader: flat; opacity: 0.92'
      });
      btn.appendChild(label);

      btn.__mvButton = { id: b.id, face: face, label: label, down: false };
      buttons.push(btn);
      holder.appendChild(btn);
    });

    return holder;
  }

  /**
   * Retroceso elástico al pulsar. Se hace con escala y no con color para
   * que se note igual con el filtro apagado y con la pantalla a punto de
   * apagarse.
   */
  function pressAnimation(btn) {
    var o = btn.object3D.scale;
    pressAnim.push({ obj: o, t: 0, dur: 0.32 });
  }

  function stepPressAnim(dt) {
    for (var i = pressAnim.length - 1; i >= 0; i--) {
      var a = pressAnim[i];
      a.t += dt;
      var p = Math.min(1, a.t / a.dur);
      // Hundirse y rebotar: sin esto, el botón no "acusa" el toque.
      var s = 1 - 0.18 * Math.sin(p * Math.PI) * (1 - p * 0.4);
      a.obj.setScalar(util.lerp(1, s, 1));
      if (p >= 1) { a.obj.setScalar(1); pressAnim.splice(i, 1); }
    }
  }

  /* ------------------------------------------------------------------ *
   * Ficha técnica
   * ------------------------------------------------------------------ */

  function buildSpecs() {
    var holder = util.entity({
      id: 'panel-specs',
      position: '0.52 ' + (CONFIG.scene.hudY - 0.02) + ' ' + (CONFIG.scene.hudZ - 0.15),
      rotation: '-20 0 22',
      visible: false
    });

    var W = 0.36, H = 0.30;
    var plate = makePanel(W, H, CONFIG.palette.magenta, 0.16, 0.8);
    holder.appendChild(plate);

    var title = makeText({
      value: 'FICHA',
      align: 'left',
      color: CONFIG.palette.magenta,
      width: W - 0.05,
      position: (-W / 2 + 0.025) + ' ' + (H / 2 - 0.035) + ' 0.002',
      'material': 'shader: flat; opacity: 0.95'
    });
    holder.appendChild(title);

    var body = makeText({
      value: '',
      align: 'left',
      color: CONFIG.palette.text,
      width: W - 0.05,
      position: (-W / 2 + 0.025) + ' ' + (H / 2 - 0.07) + ' 0.002',
      'material': 'shader: flat; opacity: 0.9'
    });
    holder.appendChild(body);

    return { holder: holder, body: body, W: W, H: H };
  }

  /* ------------------------------------------------------------------ *
   * Marcador del minijuego
   * ------------------------------------------------------------------ */

  function buildScore() {
    var holder = util.entity({
      id: 'panel-marcador',
      position: '0 ' + (CONFIG.scene.hudY + 0.42) + ' ' + CONFIG.scene.hudZ,
      visible: false
    });

    var plate = makePanel(0.42, 0.11, CONFIG.palette.cyan, 0.16, 0.9);
    holder.appendChild(plate);

    var body = makeText({
      value: '',
      align: 'center',
      color: CONFIG.palette.text,
      width: 0.38,
      position: '0 0 0.002',
      'material': 'shader: flat; opacity: 0.95'
    });
    holder.appendChild(body);

    return { holder: holder, body: body };
  }

  /* ------------------------------------------------------------------ *
   * Interacción
   * ------------------------------------------------------------------ */

  /** Botón bajo la mano, si lo hay. Mismo criterio que los hotspots. */
  function buttonUnderHand() {
    var hand = MV.stage && MV.stage.handObject ? MV.stage.handObject() : null;
    if (!hand || !visible) { return null; }
    var p = hand.getWorldPosition(new THREE.Vector3());
    var best = null, bestD = 0.085;   // 8.5 cm
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      if (!b.object3D.visible) { continue; }
      var wp = b.object3D.getWorldPosition(new THREE.Vector3());
      var d = wp.distanceTo(p);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  /**
   * Lo llama grab.js cuando hay un `selectstart` sobre algo agarrable, o
   * main.js desde el ratón. Si la mano no está sobre una bola, mira si
   * está sobre un botón: por eso los botones también viven aquí.
   */
  ui3d.pressIfHit = function () {
    var btn = buttonUnderHand();
    if (!btn) { return null; }
    pressAnimation(btn);
    var id = btn.__mvButton.id;
    document.dispatchEvent(new CustomEvent('mv:ui', { detail: { action: id } }));
    return id;
  };

  ui3d.isOverButton = function () { return !!buttonUnderHand(); };

  /* ------------------------------------------------------------------ *
   * API
   * ------------------------------------------------------------------ */

  ui3d.init = function (parentEl) {
    root = util.entity({ id: 'hud' });
    parentEl.appendChild(root);

    speech = buildSpeech();
    root.appendChild(speech.holder);

    root.appendChild(buildButtons());
    specPanel = buildSpecs();
    root.appendChild(specPanel.holder);

    scorePanel = buildScore();
    root.appendChild(scorePanel.holder);

    // Réplicas: un solo punto de escucha, el evento global.
    document.addEventListener('mv:quip', function (e) {
      if (e.detail && e.detail.text) { setQuip(e.detail.text); }
    });

    // Ficha técnica.
    document.addEventListener('mv:spec', function (e) {
      var specs = (e.detail && e.detail.specs) || [];
      var lines = [];
      for (var i = 0; i < specs.length; i++) {
        lines.push(specs[i].k + ':  ' + specs[i].v);
      }
      specPanel.body.setAttribute('wrapCount', 24);
      specPanel.body.setAttribute('value', lines.join('\n'));
      specPanel.holder.setAttribute('visible', true);
      // Se autodestruye: una ficha técnica abierta encima de la escena
      // estorba más de lo que informa.
      setTimeout(function () {
        if (specPanel) { specPanel.holder.setAttribute('visible', false); }
      }, 9000);
    });

    // Marcador.
    document.addEventListener('mv:score', function (e) {
      if (!scorePanel) { return; }
      var d = e.detail || {};
      if (d.hidden) {
        scorePanel.holder.setAttribute('visible', false);
        return;
      }
      scorePanel.holder.setAttribute('visible', true);
      scorePanel.body.setAttribute('value', d.lines || '');
    });

    // Variante: el botón cambia de texto para que se vea el estado.
    document.addEventListener('mv:variant', function (e) {
      for (var i = 0; i < buttons.length; i++) {
        if (buttons[i].__mvButton.id === 'variant') {
          var l = buttons[i].__mvButton.label;
          l.setAttribute('value', (e.detail && e.detail.label || '')
            .toUpperCase().slice(0, 9));
        }
      }
    });

    // Estado de los botones conmutables.
    document.addEventListener('mv:optical', function (e) {
      setButtonLabel('optical', e.detail.on ? 'FILTRO ON' : 'FILTRO OFF');
    });
    document.addEventListener('mv:worn', function (e) {
      setButtonLabel('wear', e.detail.worn ? 'QUITAR' : 'PONER');
    });

    util.log('HUD 3D listo.');
    return ui3d;
  };

  function setButtonLabel(id, value) {
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].__mvButton.id === id) {
        buttons[i].__mvButton.label.setAttribute('value', value);
      }
    }
  }

  /**
   * El HUD se oculta por completo mientras el usuario lleva las gafas
   * puestas o en pleno minijuego: ahí ya no hay nada que pulsar porque
   * el visor ocupa la pantalla entera.
   */
  ui3d.setVisible = function (v) {
    visible = !!v;
    if (root) { root.object3D.visible = visible; }
  };

  ui3d.isVisible = function () { return visible; };

  ui3d.tick = function (dt) {
    stepPressAnim(dt);

    if (quipTimer > 0) {
      quipTimer -= dt;
      if (quipTimer <= 0 && speech) {
        // Se desvanece en vez de desaparecer de golpe.
        var plane = speech.plane;
        var mat = plane.getAttribute('material');
        tweenFade(plane, mat ? mat.opacity : 1, 0.12, 0.5);
      }
    }
  };

  /**
   * Fundido del plano de la réplica. La opacidad vive en el componente
   * `material` (el shader es "mv-holo", no un componente), y se toca con
   * el setAttribute de tres argumentos para no pisar el resto del material.
   */
  function tweenFade(plane, from, to, dur) {
    var t = 0;
    var last = performance.now();
    (function step(now) {
      var dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
      last = now;
      t += dt;
      var p = Math.min(1, t / dur);
      var v = util.lerp(from, to, util.easeInOutCubic(p));
      plane.setAttribute('material', 'opacity', v.toFixed(3));
      if (p < 1 && plane.parentNode) { requestAnimationFrame(step); }
    }(last));
  }

  ui3d.dispose = function () {
    if (root && root.parentNode) { root.parentNode.removeChild(root); }
    root = null; speech = null; specPanel = null; scorePanel = null;
    buttons.length = 0; pressAnim.length = 0;
  };

  MV.ui3d = ui3d;
}(window.MV = window.MV || {}));
