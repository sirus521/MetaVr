/**
 * MetaVr · capa 2D.
 *
 * El HUD 3D sirve dentro de la sesión de VR. Fuera de ella el usuario está
 * en un navegador normal, y ahí lo que funciona es DOM: texto nítido,
 * scroll, botones de verdad y un botón "Entrar en VR" que el 3D no puede
 * ofrecer.
 *
 * Regla de la casa: aquí no hay lógica de juego, solo presentación. Todo
 * lo que se decide aquí se decidió antes en ui3d/showroom/game; este
 * archivo se limita a escuchar eventos y a pintar píxeles.
 *
 * El overlay se oculta solo cuando entra la sesión de VR, porque entonces
 * el HUD 3D toma el relevo.
 */
(function (MV) {
  'use strict';

  var util = MV.util;
  var CONFIG = MV.CONFIG;
  var hud = {};

  var root = null;
  var quipEl = null;
  var scoreEl = null;
  var specEl = null;
  var specBody = null;
  var variantEl = null;
  var idleEl = null;
  var toastEl = null;
  var bootEl = null;
  var quipTimer = 0;
  var idleSince = performance.now();

  /* ------------------------------------------------------------------ *
   * Construcción
   * ------------------------------------------------------------------ */

  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text !== undefined) { e.textContent = text; }
    return e;
  }

  function buildBar() {
    var bar = h('div', 'mv-bar');

    var brand = h('div', 'mv-brand');
    brand.appendChild(h('span', 'mv-brand-name', CONFIG.product.name));
    brand.appendChild(h('span', 'mv-brand-tag', CONFIG.product.tagline));
    bar.appendChild(brand);

    var controls = h('div', 'mv-controls');

    // Las mismas cinco acciones que el HUD 3D, por el mismo despachador.
    // Así los dos interfaces nunca pueden divergir.
    controls.appendChild(button('Filtro', 'mv-btn', function () {
      MV.main.runAction('optical');
    }));
    controls.appendChild(button('Acabado', 'mv-btn', function () {
      MV.main.runAction('variant');
    }));
    controls.appendChild(button('Vista', 'mv-btn', function () {
      MV.main.runAction('explode');
    }));
    controls.appendChild(button('Poner', 'mv-btn mv-btn-accent', function () {
      MV.main.runAction('wear');
    }));
    controls.appendChild(button('Juego', 'mv-btn mv-btn-play', function () {
      MV.main.runAction('game');
    }));

    bar.appendChild(controls);
    return bar;
  }

  function button(label, cls, onClick) {
    var b = h('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', function (e) {
      e.preventDefault();
      idle();
      onClick(e);
      // Un destello mínimo para confirmar el toque sin esperar al 3D.
      b.classList.add('is-pressed');
      setTimeout(function () { b.classList.remove('is-pressed'); }, 140);
    });
    return b;
  }

  /* ------------------------------------------------------------------ *
   * API
   * ------------------------------------------------------------------ */

  hud.init = function (parentEl) {
    root = h('div', 'mv-hud');
    root.id = 'mv-hud';

    /* Cabecera */
    root.appendChild(buildBar());

    /* Réplica del visor, abajo al centro. */
    quipEl = h('div', 'mv-quip');
    quipEl.id = 'mv-quip';
    root.appendChild(quipEl);

    /* Marcador, arriba a la derecha. */
    scoreEl = h('div', 'mv-score is-hidden');
    scoreEl.id = 'mv-score';
    root.appendChild(scoreEl);

    /* Ficha técnica, lateral. */
    specEl = h('div', 'mv-specs is-hidden');
    specEl.id = 'mv-specs';
    specEl.appendChild(h('h2', 'mv-specs-title', 'Ficha técnica'));
    specBody = h('dl', 'mv-specs-body');
    specEl.appendChild(specBody);
    var close = h('button', 'mv-specs-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Cerrar la ficha técnica');
    close.addEventListener('click', function () { specEl.classList.add('is-hidden'); });
    specEl.appendChild(close);
    root.appendChild(specEl);

    /* Variante actual. */
    variantEl = h('div', 'mv-variant is-hidden', '');
    root.appendChild(variantEl);

    /* Aviso corto (entradas de juego, logros). */
    toastEl = h('div', 'mv-toast is-hidden');
    root.appendChild(toastEl);

    /* Pie con los controles del ratón. */
    var hint = h('div', 'mv-hint');
    hint.innerHTML =
      '<b>Arrastra</b> para orbitar · <b>Rueda</b> para acercar · ' +
      '<b>Clic</b> en una bola para cogerla y lanzarla';
    root.appendChild(hint);

    /* Aviso de inactividad. */
    idleEl = h('div', 'mv-idle is-hidden');
    root.appendChild(idleEl);

    /* Arranque */
    bootEl = h('div', 'mv-boot');
    bootEl.appendChild(h('div', 'mv-boot-name', CONFIG.product.name));
    bootEl.appendChild(h('div', 'mv-boot-tag', CONFIG.product.tagline));
    root.appendChild(bootEl);

    parentEl.appendChild(root);
    wireEvents();
    util.log('Capa 2D lista.');
    return hud;
  };

  function wireEvents() {
    // Réplica del visor.
    document.addEventListener('mv:quip', function (e) {
      if (!e.detail || !e.detail.text) { return; }
      showQuip(e.detail.text);
    });

    // Marcador del minijuego.
    document.addEventListener('mv:score', function (e) {
      var d = e.detail || {};
      if (d.hidden || !d.lines) {
        scoreEl.classList.add('is-hidden');
        return;
      }
      scoreEl.textContent = d.lines;
      scoreEl.classList.remove('is-hidden');
    });

    // Ficha técnica.
    document.addEventListener('mv:spec', function (e) {
      var specs = (e.detail && e.detail.specs) || MV.showroom.specs();
      specBody.innerHTML = '';
      specs.forEach(function (s) {
        specBody.appendChild(h('dt', null, s.k));
        specBody.appendChild(h('dd', null, s.v));
      });
      specEl.classList.remove('is-hidden');
      specEl.classList.remove('is-enter');
      // Reiniciamos la animación de entrada.
      void specEl.offsetWidth;
      specEl.classList.add('is-enter');
    });

    // Variante.
    document.addEventListener('mv:variant', function (e) {
      var label = (e.detail && e.detail.label) || '';
      variantEl.textContent = 'Acabado · ' + label;
      variantEl.classList.remove('is-hidden', 'is-enter');
      void variantEl.offsetWidth;
      variantEl.classList.add('is-enter');
    });

    // Filtro.
    document.addEventListener('mv:optical', function (e) {
      toast(e.detail.on ? 'Filtro óptico activado' : 'Filtro óptico apagado');
    });

    // Puesto / quitado.
    document.addEventListener('mv:worn', function (e) {
      toast(e.detail.worn
        ? 'Ahora sí. Bienvenido.'
        : 'Fuera de la cabeza de nuevo');
    });

    // Fin de partida.
    document.addEventListener('mv:gameover', function (e) {
      var d = e.detail || {};
      toast('Final: ' + d.score + ' puntos · ' + d.hits + ' aciertos');
    });

    // El overlay se aparta cuando entra la VR, porque ahí manda el HUD 3D.
    if (MV.stage && MV.stage.el) {
      MV.stage.el.addEventListener('enter-vr', function () {
        root.classList.add('is-vr');
      });
      MV.stage.el.addEventListener('exit-vr', function () {
        root.classList.remove('is-vr');
      });
    }

    // Cualquier interacción cuenta como "el usuario está aquí".
    ['pointerdown', 'keydown', 'wheel'].forEach(function (ev) {
      window.addEventListener(ev, idle, { passive: true });
    });
  }

  function idle() { idleSince = performance.now(); }

  function showQuip(text) {
    quipEl.textContent = text;
    quipEl.classList.remove('is-hidden', 'is-enter');
    void quipEl.offsetWidth;   // reinicia la animación
    quipEl.classList.add('is-enter');
    quipTimer = 5;
  }

  var toastTimer = 0;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.remove('is-hidden', 'is-enter');
    void toastEl.offsetWidth;
    toastEl.classList.add('is-enter');
    toastTimer = 2.6;
  }

  /** El overlay se llama `hud` y se apaga cuando entra la sesión. */
  hud.tick = function (dt) {
    if (quipTimer > 0) {
      quipTimer -= dt;
      if (quipTimer <= 0) { quipEl.classList.add('is-hidden'); }
    }
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) { toastEl.classList.add('is-hidden'); }
    }
    var idleFor = (performance.now() - idleSince) / 1000;
    if (idleFor > 45) {
      if (idleEl.classList.contains('is-hidden')) {
        idleEl.textContent = 'Pulsa algo. Sé que estás ahí.';
        idleEl.classList.remove('is-hidden', 'is-enter');
        void idleEl.offsetWidth;
        idleEl.classList.add('is-enter');
        MV.quip.say('idle');
      }
    } else {
      idleEl.classList.add('is-hidden');
    }
  };

  /** El aviso de arranque se retira cuando la escena ya está en pantalla. */
  hud.ready = function () {
    if (bootEl) {
      bootEl.classList.add('is-gone');
      MV.quip.say('boot');
    }
    idle();
  };

  /** El botón nativo de A-Frame se sustituye por el nuestro. */
  hud.decorateVRButton = function (sceneEl) {
    var native = sceneEl.querySelector('.a-enter-vr-button, #VRButton');
    if (!native) { return; }
    native.classList.add('mv-vr-native');
    native.textContent = 'Entrar en VR';
  };

  hud.dispose = function () {
    if (root && root.parentNode) { root.parentNode.removeChild(root); }
    root = null; quipEl = null; scoreEl = null; specEl = null;
  };

  MV.hud = hud;
}(window.MV = window.MV || {}));
