/**
 * MetaVr · minijuego de lanzamiento.
 *
 * La mecánica: hay un cubo de bolas encima del pedestal y tienes que
 * lanzárselas al visor. Cada bola que acierta con suficiente velocidad
 * suma puntos, y la puntuación depende de cómo la sueltes, no de dónde
 * aprietes.
 *
 * ── Rondas ────────────────────────────────────────────────────────────
 * Tres rondas de 60 segundos. Las bolas se reponen, no se consumen: si se
 * acaban, el juego se acaba. Con eso basta para tener un objetivo sin que
 * el jugador tenga que estar pensando en la gestión.
 *
 * ── Puntuación ────────────────────────────────────────────────────────
 * Puntos = velocidad de impacto × factor de precisión, con topes. El tope
 * por golpe importa: sin él, soltar la bola con la velocidad máxima de la
 * mano desde el último frame gana siempre, y el juego deja de tener
 * decisiones.
 *
 * ── Jelly ─────────────────────────────────────────────────────────────
 * Las bolas se deforman al golpear. Es el mismo material de todas, así que
 * solo animamos la escala: sin mallas nuevas, sin coste extra.
 */
(function (MV) {
  'use strict';

  var util = MV.util;
  var CONFIG = MV.CONFIG;
  var game = {};

  var sceneEl = null;
  var visorEl = null;
  var balls = [];
  // idle (fuera de juego) | playing (cuenta atrás) | between (descanso entre
  // rondas) | over. El estado `between` existe por un motivo concreto:
  // durante el descanso la cuenta atrás ya llegó a cero, y si el estado
  // siguiera siendo `playing` el tick volvería a llamar a endRound() en cada
  // frame y se acumularían 200 temporizadores de cambio de ronda.
  var state = 'idle';
  var round = 0;
  var score = 0;
  var timeLeft = 0;
  var hits = 0;
  var bestSpeed = 0;
  var roundTimer = 0;        // setTimeout pendiente entre rondas

  /* ------------------------------------------------------------------ *
   * Fabricación de bolas
   * ------------------------------------------------------------------ */

  /**
   * La geometría de la bola es una icosfera: pocas caras para la
   * cantidad de bolas que hay a la vez, y a esta escala no se nota.
   */
  var ballGeo = null;

  function makeBallGeometry() {
    if (ballGeo) { return ballGeo; }
    var R = CONFIG.physics.ballRadius;
    ballGeo = new THREE.IcosahedronGeometry(R, 2);
    return ballGeo;
  }

  function ballMaterial(color) {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      metalness: 0.25,
      roughness: 0.35,
      // Un poco de emisión para que se vean en el fondo oscuro sin
      // necesidad de una luz extra.
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.18
    });
  }

  /** Crea una bola en la escena y la registra. */
  function spawnBall(index) {
    var i = index % CONFIG.minigame.balls;
    // Rejilla sobre el pedestal, en espiral. Separadas para que se
    // puedan coger dos sin pegarse.
    var ang = i * 2.399963;              // ángulo áureo: reparto uniforme
    var rad = 0.055 + 0.028 * Math.sqrt(i);
    var x = Math.cos(ang) * rad;
    var z = Math.sin(ang) * rad;
    var y = CONFIG.scene.pedestalY + 0.045;

    var el = util.entity({
      id: 'bola-' + i,
      class: 'agarrable',
      position: x + ' ' + y + ' ' + (CONFIG.scene.pedestalZ + z)
    });

    var mesh = new THREE.Mesh(makeBallGeometry(), ballMaterial(CONFIG.palette.cyan));
    mesh.name = 'malla';
    mesh.castShadow = true;
    el.setObject3D('malla', mesh);

    el.setAttribute('dynamic-body', {
      mass: CONFIG.physics.ballMass,
      linearDamping: CONFIG.physics.ballLinearDamping,
      angularDamping: CONFIG.physics.ballAngularDamping
    });
    // El colisionador es la esfera. En vez de `shape: auto` sobre la
    // entidad (que intentaría un hull del mesh), lo declaramos
    // explícito: más barato y exacto.
    el.setAttribute('shape', {
      shape: 'sphere',
      sphereRadius: CONFIG.physics.ballRadius
    });

    sceneEl.appendChild(el);
    MV.grab.register(el);

    // `home` es la posición MUNDIAL, no la local: el body de la física vive
    // en coordenadas de mundo. Guardar aquí el offset del pedestal (sin el
    // `pedestalZ`) reseteaba todas las bolas al origen, unas encima de
    // otras, y no al cubo de arriba.
    var rec = {
      el: el,
      mesh: mesh,
      index: i,
      home: new THREE.Vector3(x, y, CONFIG.scene.pedestalZ + z)
    };
    balls.push(rec);
    return rec;
  }

  /* ------------------------------------------------------------------ *
   * Puntuación
   * ------------------------------------------------------------------ */

  /**
   * Cuánto vale un golpe. La velocidad manda, pero saturamos: a partir de
   * cierto punto, más velocidad no da más puntos.
   */
  function pointsFor(speed) {
    var M = CONFIG.minigame;
    var norm = speed / M.maxScorePerHit;
    if (norm > 1) { norm = 1; }
    // Raíz cuadrada: hace que los golpes medios valgan bastante, que es
    // lo que hace que el juego sea jugable con mando.
    var base = M.scorePerImpact * Math.sqrt(norm);
    return Math.round(base);
  }

  function onImpact(evt) {
    if (state !== 'playing') { return; }
    var speed = evt.detail && evt.detail.speed ? evt.detail.speed : 0;
    if (speed < CONFIG.minigame.minImpactSpeed) { return; }

    var gained = pointsFor(speed);
    score += gained;
    hits += 1;
    if (speed > bestSpeed) { bestSpeed = speed; }

    // Deformación: el "jelly" del impacto. Solo escala, sin mallas nuevas.
    squash(findBall(evt.detail.other));

    MV.quip.say('hit');
    updateScore();
  }

  /** La bola implicada en el choque, o null si fue otra cosa. */
  function findBall(otherEl) {
    for (var i = 0; i < balls.length; i++) {
      if (balls[i].el === otherEl) { return balls[i]; }
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Animación de deformación
   * ------------------------------------------------------------------ */

  /**
   * Deformación por impacto. Solo toca la escala del mesh, así que no
   * genera geometría ni toca el body físico: la bola sigue siendo una
   * esfera para el colisionador mientras se deforma por debajo.
   *
   * Se anima con su propio rAF y no desde el bucle global a propósito: son
   * 10 animaciones cortas y desacopladas, y no merece la pena ensuciar el
   * `game.tick` con una lista de estado que habría que depurar.
   */
  function squash(rec) {
    if (!rec) { return; }
    var s = rec.mesh.scale;
    var amount = 0.06 + Math.random() * 0.05;
    // Aplastón: corto en Y, estirado en XZ.
    s.set(1 + amount, 1 - amount, 1 + amount);

    var last = performance.now();
    var step = function (now) {
      // dt real, no 1/60 asumido: con el headset a 72 Hz y el 2D a 144 Hz,
      // un 1/60 fijo hace que la deformación vaya a distinta velocidad.
      var dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
      last = now;
      s.set(
        util.damp(s.x, 1, 22, dt),
        util.damp(s.y, 1, 22, dt),
        util.damp(s.z, 1, 22, dt)
      );
      var off = Math.max(
        Math.abs(s.x - 1), Math.abs(s.y - 1), Math.abs(s.z - 1)
      );
      if (off > 0.004) {
        requestAnimationFrame(step);
      } else {
        s.setScalar(1);
      }
    };
    requestAnimationFrame(step);
  }

  /* ------------------------------------------------------------------ *
   * Rondas
   * ------------------------------------------------------------------ */

  function startRound() {
    round += 1;
    timeLeft = CONFIG.minigame.roundSeconds;
    state = 'playing';
    // Reposición: cada bola vuelve al pedestal y duerme. `velocity` a cero
    // es mejor que tocar el body, porque el body se actualiza después.
    for (var i = 0; i < balls.length; i++) {
      resetBall(balls[i]);
    }
    if (!balls.length) {
      for (var s = 0; s < CONFIG.minigame.balls; s++) { spawnBall(s); }
    }
    MV.physics.respawnGlasses();
    MV.quip.say('gameStart');
    updateScore();
  }

  function resetBall(rec) {
    var b = rec.el.body;
    if (b) {
      b.wakeUp();
      b.velocity.set(0, 0, 0);
      b.angularVelocity.set(0, 0, 0);
      b.position.set(rec.home.x, rec.home.y, rec.home.z);
      b.quaternion.set(0, 0, 0, 1);
    }
    rec.mesh.scale.setScalar(1);
  }

  function endRound() {
    if (state !== 'playing') { return; }   // guarda contra dobles llamadas

    if (round >= CONFIG.minigame.rounds) {
      state = 'over';
      document.dispatchEvent(new CustomEvent('mv:gameover', {
        detail: { score: score, hits: hits, best: Math.round(bestSpeed * 10) / 10 }
      }));
      MV.quip.say('gameEnd');
      document.dispatchEvent(new CustomEvent('mv:score', {
        detail: { hidden: true }
      }));
      return;
    }

    // Descanso entre rondas. El estado cambia a `between` para que el tick
    // deje de decrementar una cuenta atrás que ya está en cero.
    state = 'between';
    document.dispatchEvent(new CustomEvent('mv:score', {
      detail: { lines: 'Ronda ' + round + ' · ' + score + ' pts\nPreparados…' }
    }));
    clearTimeout(roundTimer);
    roundTimer = setTimeout(function () {
      roundTimer = 0;
      startRound();
    }, 3500);
  }

  function updateScore() {
    if (state === 'idle') {
      document.dispatchEvent(new CustomEvent('mv:score', { detail: { hidden: true } }));
      return;
    }
    var m = Math.floor(timeLeft / 60);
    var s = Math.floor(timeLeft % 60);
    var clock = m + ':' + (s < 10 ? '0' : '') + s;
    document.dispatchEvent(new CustomEvent('mv:score', {
      detail: {
        lines: 'RONDA ' + round + '/' + CONFIG.minigame.rounds +
               '   ' + clock + '\n' + score + ' PUNTOS   ·   ' + hits + ' ACIERTOS'
      }
    }));
  }

  /* ------------------------------------------------------------------ *
   * API
   * ------------------------------------------------------------------ */

  game.init = function (el, opts) {
    sceneEl = el;
    visorEl = opts.visorEl;

    visorEl.addEventListener('mv:impact', onImpact);

    util.log('Minijuego listo.');
    return game;
  };

  game.start = function () {
    if (state === 'playing' || state === 'between') { return state; }
    state = 'playing';
    round = 0;
    score = 0;
    hits = 0;
    bestSpeed = 0;
    startRound();
    return state;
  };

  game.stop = function () {
    if (state === 'idle') { return; }
    state = 'idle';
    // Sin esto, pulsar "Juego" durante el descanso de 3,5 s dejaba un
    // temporizador vivo que arrancaba una ronda sola detrás.
    clearTimeout(roundTimer);
    roundTimer = 0;
    document.dispatchEvent(new CustomEvent('mv:score', { detail: { hidden: true } }));
  };

  game.toggle = function () {
    if (state === 'playing' || state === 'between') { game.stop(); return 'idle'; }
    return game.start();
  };

  game.state = function () { return state; };
  game.score = function () { return score; };
  game.round = function () { return round; };
  game.hits = function () { return hits; };
  game.ballCount = function () { return balls.length; };

  /** ¿Ha salido alguna bola del área de juego? El easter egg lo vigila. */
  game.lostBall = function () {
    for (var i = 0; i < balls.length; i++) {
      if (balls[i].el.object3D.position.y < -1.5) { return true; }
    }
    return false;
  };

  game.tick = function (dt) {
    if (state !== 'playing') { return; }
    timeLeft -= dt;
    // El marcador se refresca a 4 Hz: cada frame sería texto nuevo en la
    // textura y eso sí se nota.
    if (timeLeft - (game._last || 0) < 0.25) {
      game._last = timeLeft;
      updateScore();
    }
    if (timeLeft <= 0) { endRound(); }
  };

  game.dispose = function () {
    game.stop();
    visorEl = null; sceneEl = null; balls.length = 0;
  };

  MV.game = game;
}(window.MV = window.MV || {}));
