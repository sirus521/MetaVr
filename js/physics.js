/**
 * MetaVr · mundo físico.
 *
 * Configura el sistema cannon sobre la escena y construye el decorado
 * estático (suelo + pedestal) y el cuerpo compuesto del visor.
 *
 * Dos avisos que vienen de leer el código de la librería, no de la doc:
 *   · `debug` sale en true por defecto. Hay que apagarlo explícitamente o
 *     la escena aparece llena de alambres rojos.
 *   · cannon-es no tiene detección continua: un proyectil demasiado rápido
 *     atraviesa los colisionadores. Por eso topamos la velocidad de
 *     lanzamiento en config.physics.maxThrowSpeed.
 */
(function (MV) {
  'use strict';

  var util = MV.util;
  var CONFIG = MV.CONFIG;
  var physics = {};

  var sceneEl = null;
  var system = null;
  var glassesEl = null;
  var pedestalEl = null;
  var floorEl = null;

  var lastHitAt = 0;

  /* ------------------------------------------------------------------ *
   * Decorado estático
   * ------------------------------------------------------------------ */

  function buildWorld(el) {
    var s = CONFIG.scene;

    floorEl = document.createElement('a-plane');
    floorEl.id = 'suelo';
    floorEl.setAttribute('rotation', '-90 0 0');
    floorEl.setAttribute('width', s.floorSize);
    floorEl.setAttribute('height', s.floorSize);
    floorEl.setAttribute('position', '0 0 0');
    // Colisionador propio, y por dos motivos medidos:
    //
    // 1) `halfExtents` y `offset` en el string multi-prop de `static-body`
    //    se IGNORAN: el sistema deriva la caja de las medidas del primitivo.
    //    Medido con un `a-plane` de 24x24: pedíamos 12 0.05 12 y salía
    //    (12, 12, 0). La única forma de fijarlos es un componente `shape__*`
    //    con valor de objeto, que es lo que ya hace el visor.
    // 2) La caja que se deriva de un `a-plane` es 24x24x0.2 centrada en el
    //    elemento, así que su cara superior queda 10 cm POR ENCIMA del suelo
    //    que se ve. Medido: las bolas quedaban flotando sobre la rejilla.
    //
    // Con `offset` la bajamos para que su cara superior coincida exactamente
    // con el plano visible. Y la hacemos PROFUNDA (2 m de canto) a propósito:
    // el grosor no se ve nunca porque el suelo visible es un plano, y en
    // cambio es lo único que impide que un cuerpo se lossa a través. Medido:
    // con 10 cm de canto, el visor cae por encima de 6 m/s y se va entero (a
    // 17 m/s avanza 28 cm por paso, más que el canto). Sin CCD en cannon, la
    // profundidad del colisionador es la defensa; 2 m aguantan hasta 30 m/s.
    floorEl.setAttribute('body', { type: 'static', shape: 'none' });
    floorEl.setAttribute('shape__suelo', {
      shape: 'box',
      halfExtents: (s.floorSize / 2) + ' 1 ' + (s.floorSize / 2),
      offset: '0 -1 0'
    });
    // Material del suelo: rejilla cian muy tenue. Da escala y profundidad
    // sin coste de geometría ni de sombras.
    //
    // La rejilla entra por `src` y como data URL, no como THREE.Texture: el
    // componente `material` de A-Frame solo acepta una URL, y darle una
    // textura en `map` no falla, la ignora con un aviso y el suelo sale liso.
    floorEl.setAttribute('material', {
      color: '#070c12',
      emissive: '#0d2b30',
      emissiveIntensity: 0.9,
      src: util.gridDataUrl(512, MV.CONFIG.palette.cyan, 0.16),
      transparent: true,
      opacity: 0.85,
      metalness: 0.15,
      roughness: 0.72
    });
    el.appendChild(floorEl);

    pedestalEl = document.createElement('a-cylinder');
    pedestalEl.id = 'pedestal';
    pedestalEl.setAttribute('radius', '0.30');
    pedestalEl.setAttribute('height', '0.045');
    pedestalEl.setAttribute('position', '0 ' + s.pedestalY + ' ' + s.pedestalZ);
    // El colisionador es una caja, no el cilindro que se deduce del
    // primitivo, y no es una aproximación: es la exacta. El `Cylinder` de
    // cannon construye sus vértices como (r·cos, r·sin, ±height/2), o sea
    // con el EJE EN Z, mientras que el `a-cylinder` de Three es vertical. Por
    // eso el colisionador automático sale tumbado: un disco de 60 cm de alto
    // atravesado en la pedestal. Medido, el visor se apoyaba en el canto de
    // esa rueda y no en la superficie, y además quedaba una pared curva
    // invisible alrededor. Una caja es OrientedBox en el motor y además sale
    // más barata: Narrowphase caja-caja en vez de poliedro-convexo, que es el
    // caso caro.
    //
    // Las medidas se dan con `shape__*` y objeto porque en el string
    // multi-prop de `static-body` se ignorarían (ver la nota del suelo).
    //
    // El canto es de 10 cm, no de 4,5 cm, y la cara SUPERIOR sigue siendo
    // exactamente la del cilindro visible. Motivo, medido: con la losa de
    // 4,5 cm el visor se hundía 5 cm dentro de ella y, al pasarse del canto
    // inferior, cannon invertía las normales del contacto (de (0,1,0) a
    // (0,-1,0)) y lo disparaba hacia abajo: el producto se iba al suelo y
    // seguía cayendo. Con 10 cm de canto la inversión necesitaría una
    // penetración imposible, y de rebote sigue siendo una placa fina, así que
    // no se comporta como una pared invisible para las bolas del minijuego.
    pedestalEl.setAttribute('body', { type: 'static', shape: 'none' });
    pedestalEl.setAttribute('shape__pedestal', {
      shape: 'box',
      halfExtents: '0.30 0.05 0.30',
      offset: '0 -0.0275 0'
    });
    pedestalEl.setAttribute('shadow', 'cast: false; receive: true');
    pedestalEl.setAttribute('material', {
      color: '#0a1017',
      metalness: 0.7,
      roughness: 0.4
    });
    el.appendChild(pedestalEl);

    // Anillo luminoso del pedestal: el detalle de motion más visible desde
    // cualquier ángulo, y prácticamente gratis (es el shader de holograma).
    var ring = MV.materials.holo({
      width: 0.50,
      height: 0.50,
      color: CONFIG.palette.cyan,
      opacity: 0.30,
      power: 3.0,
      speed: 0.22,
      position: '0 ' + (s.pedestalY + 0.0235) + ' ' + s.pedestalZ,
      rotation: '-90 0 0'
    });
    ring.id = 'anillo-pedestal';
    el.appendChild(ring);
    // El plano del anillo necesita UVs mapeadas para que el degradado
    // radial funcione; un plano de A-Frame ya las trae.
    return { floor: floorEl, pedestal: pedestalEl, ring: ring };
  }

  /* ------------------------------------------------------------------ *
   * Cuerpo del visor
   * ------------------------------------------------------------------ */

  /**
   * Colisionador compuesto: una sola caja que envuelve montura y patillas.
   * Un hull sería más fiel pero en un cuerpo dinámico se nota en el
   * rendimiento y aquí no aporta nada visible.
   */
  function attachBody(el, halfExtents) {
    el.setAttribute('body', {
      type: 'dynamic',
      shape: 'none',
      mass: CONFIG.physics.glassesMass,
      linearDamping: CONFIG.physics.glassesLinearDamping,
      angularDamping: CONFIG.physics.glassesAngularDamping
    });
    el.setAttribute('shape__visor', {
      shape: 'box',
      halfExtents: halfExtents.join(' '),
      offset: '0 0 0'
    });
  }

  /* ------------------------------------------------------------------ *
   * API
   * ------------------------------------------------------------------ */

  /**
   * Se llama desde main.js cuando la escena ya está cargada.
   * @param {object} opts {glassesGroup, meta}
   */
  physics.setup = function (el, opts) {
    sceneEl = el;
    system = el.systems.physics;

    if (!system) {
      util.warnOnce('physics', 'El sistema "physics" no está en la escena. ¿Falta el script?');
      return false;
    }

    var world = buildWorld(el);

    /* --- El visor, como entidad física --- */
    glassesEl = util.entity({
      id: 'visor',
      position: '0 ' + (CONFIG.scene.pedestalY + 0.058) + ' ' + CONFIG.scene.pedestalZ,
      rotation: '0 -16 0'
    });

    // El grupo procedural entra como objeto 3D de la entidad: así la
    // física mueve la entidad y el modelo le sigue.
    glassesEl.setObject3D('mesh', opts.glassesGroup);
    attachBody(glassesEl, opts.meta.halfExtents);
    el.appendChild(glassesEl);

    /* --- Contactos: los necesita el minijuego para puntuar --- */
    glassesEl.addEventListener('collide', function (evt) {
      var speed = 0;
      var contact = evt.detail && evt.detail.contact;
      if (contact && typeof contact.getImpactVelocityAlongNormal === 'function') {
        speed = Math.abs(contact.getImpactVelocityAlongNormal());
      } else if (contact && contact.bi && contact.bj) {
        // Respaldo manual por si el método no existiera.
        var rel = contact.bi.velocity.vsub(contact.bj.velocity);
        speed = rel.length();
      }

      var now = performance.now();
      // El evento `collide` se repite mientras los cuerpos se tocan en
      // reposo. Sin esta ventana, un roce puntúa 40 veces por segundo.
      if (now - lastHitAt < CONFIG.minigame.hitCooldownMs) { return; }
      lastHitAt = now;

      glassesEl.emit('mv:impact', {
        speed: speed,
        other: evt.detail && evt.detail.body ? evt.detail.body.el : null,
        contact: contact
      });
    });

    glassesEl.addEventListener('body-loaded', function () {
      glassesEl.emit('mv:visor-ready', {});
    });

    physics.glassesEl = glassesEl;
    physics.floorEl = world.floor;
    physics.pedestalEl = world.pedestal;
    physics.ringEl = world.ring;
    physics.system = system;
    physics.sceneEl = sceneEl;

    // El driver local del sistema hace esto:
    //
    //     LocalDriver.prototype.step = function (dt) { this.world.step(dt) }
    //
    // Un ÚNICO paso variable del tamaño del frame, sin subpasos, y sin usar
    // los `fixedTimeStep` y `maxSubSteps` que el propio sistema declara. El
    // `tick` limita el dt a `maxInterval` (4/60 = 66,7 ms), y con solo 5 fps
    // (SwiftShader) eso significa 66,7 ms de golpe: un cuerpo que cae a 1 m/s
    // avanza 6,7 cm en un paso, más que el canto de 4,5 cm del pedestal.
    //
    // Con la API de subpasos de cannon cada integración dura 1/60 (1,7 cm a
    // 1 m/s) y la simulación deja de ir a saltos: un frame lento ya no
    // teletransporta el mundo. Esto NO arregla el reposo (ver `physics.tick`),
    // pero evita que un frame lento mande el visor al abismo.
    var driver = system.driver;
    if (driver && !driver.__mvFixedStep) {
      driver.__mvFixedStep = driver.step;
      driver.step = function (dt) {
        return driver.world.step(system.data.fixedTimeStep, dt, system.data.maxSubSteps);
      };
    }

    // Y los parámetros de contacto que la escena pide en `physics="..."` NO
    // llegaban nunca a cannon. El sistema solo los aplica si cada entidad
    // declara su propio material, y aquí ninguna lo hace: todas caen al
    // `defaultMaterial` del mundo. Medido con la escena pidiendo
    // `contactEquationStiffness: 1e8, friction: 0.4, restitution: 0.32`, y el
    // mundo usando 1e7, 0,3 y 0. Ahora los parámetros del mundo son los de la
    // escena, que es lo que pedía el diseño, pero ojo: subir la rigidez NO
    // arregla el reposo (probado hasta 1e9, ver `physics.tick`).
    if (driver && driver.world && driver.world.defaultContactMaterial) {
      var cm = driver.world.defaultContactMaterial;
      if (typeof system.data.contactEquationStiffness === 'number') {
        cm.contactEquationStiffness = system.data.contactEquationStiffness;
      }
      if (typeof system.data.frictionEquationStiffness === 'number') {
        cm.frictionEquationStiffness = system.data.frictionEquationStiffness;
      }
      if (typeof system.data.contactEquationRelaxation === 'number') {
        cm.contactEquationRelaxation = system.data.contactEquationRelaxation;
      }
      if (typeof system.data.friction === 'number') { cm.friction = system.data.friction; }
      if (typeof system.data.restitution === 'number') { cm.restitution = system.data.restitution; }
    }

    util.log('Física lista. Colisionador del visor: ' + opts.meta.halfExtents.join(' × '));
    return true;
  };

  /**
   * Altura a la que el visor se queda quieto sobre el pedestal.
   *
   * Se calcula con la geometría real del colisionador, no con una constante
   * inventada: cara superior de la caja del pedestal + media altura de la
   * caja del visor. Medido: con el `+0.058` de antes el visor aparecía 9,5 mm
   * POR ENCIMA de la superficie, porque la media altura del marco es 26 mm y
   * el borde del pedestal está 22,5 mm por encima de su centro.
   */
  function restY() {
    if (!glassesEl || !glassesEl.body || !pedestalEl || !pedestalEl.body) { return null; }
    var ped = pedestalEl.body;
    var pedTop = ped.position.y + ped.shapeOffsets[0].y +
                 ped.shapes[0].halfExtents.y;
    return pedTop + glassesEl.body.shapes[0].halfExtents.y;
  }

  /**
   * Asienta el cuerpo sobre una superficie: le pone la `y` exacta y le quita
   * la velocidad vertical. Deja intacto el resto (si está resbalando o
   * rodando, sigue haciéndolo), que para eso el asiento solo interviene
   * verticalmente.
   */
  function asentar(b, y) {
    if (Math.abs(b.position.y - y) > 0.0002 || Math.abs(b.velocity.y) > 0.0005) {
      b.position.y = y;
      b.velocity.y = 0;
      b.aabbNeedsUpdate = true;
    }
  }

  /**
   * Mientras lo están agarrando no se toca nada, para que el asiento no pelee
   * con la restricción del agarre.
   */
  function puedeAsentar() {
    if (MV.grab && MV.grab.isGrabbing() && MV.grab.grabbedEl() === glassesEl) { return false; }
    return true;
  }

  /**
   * El visor nunca debe quedarse dentro del pedestal ni dentro del suelo.
   *
   * cannon no consigue sostenerlo: el contacto es unas 30 veces más blando de
   * lo que dicen sus propios parámetros, el cuerpo se hunde 4-5 cm dentro del
   * pedestal y, al pasarse del canto inferior, la normal se invierte y lo
   * expulsa hacia abajo (medido: y = -2,5 m, el producto por el suelo y
   * después cayendo al vacío). Con el suelo pasa igual de mal, solo que más
   * despacio: medido, desde 1,5 m llegó a y = -0,65 atravesando los 2 m de
   * losa. Se probó subir la rigidez a 1e9, bajar la relajación, 50 iteraciones,
   * forzar `world.dt` a 1/60, paso simple y restitución 0: los siete ensayos
   * dan el mismo resultado, así que el defecto es del solver de este build y no
   * se arregla desde la app.
   *
   * Por eso hay dos asientos, y la condición es solo geométrica: dentro de la
   * huella, y con el centro a la altura de la superficie o por debajo. No hay
   * condición de velocidad, y ese es el punto que costó la medición: al cruzar
   * la superficie, un cuerpo que va a 4 m/s pasa de 1 cm por encima a 1 cm por
   * debajo en un par de pasos, así que cualquier guarda de velocidad lo
   * dejaba seguir de largo. Y el asiento se evalúa una vez por frame, no por
   * subpaso: a 5 fps eso son hasta 30 cm de recorrido entre dos controles.
   *
   * Un cuerpo que está de verdad en el aire por encima de la superficie no
   * cumple la condición, así que no se atrapa a nadie en vuelo. Lo único que
   * se toca es la vertical: si está resbalando o rodando, sigue haciéndolo.
   */
  physics.tick = function () {
    if (!glassesEl || !glassesEl.body) { return; }
    var b = glassesEl.body;

    // Red de seguridad, para lo que se sale de la escena: un lanzamiento
    // fuerte lo manda fuera del suelo y ya no hay superficie donde restingar.
    // OJO con el umbral: tiene que medirse desde el suelo (y = 0), no desde
    // el pedestal, o cualquier cosa que resbale del pedestal vuelve por
    // teletransporte y el visor nunca puede quedarse en el suelo. Y no se
    // reutiliza `isVisorGrounded` porque ese predicado pregunta por otra
    // cosa ("¿ha bajado del pedestal?"), que es lo que quiere el easter egg.
    if (b.position.y < -2.5) { physics.respawnGlasses(); return; }
    if (!puedeAsentar()) { return; }

    // Asiento del pedestal.
    var y = restY();
    if (y !== null && Math.abs(b.position.x) <= 0.24 &&
        Math.abs(b.position.z - CONFIG.scene.pedestalZ) <= 0.24 &&
        b.position.y <= y + 0.03) {
      asentar(b, y);
      return;
    }

    // Asiento del suelo: la cara superior de la losa está en y = 0, así que
    // el centro del visor se queda a media altura, 26 mm.
    var sueloY = b.shapes[0].halfExtents.y;
    var medio = CONFIG.scene.floorSize / 2 - b.shapes[0].halfExtents.x;
    if (Math.abs(b.position.x) <= medio && Math.abs(b.position.z) <= medio &&
        b.position.y <= sueloY + 0.03) {
      asentar(b, sueloY);
    }
  };

  /**
   * Devuelve el visor a su sitio en el pedestal y le quita el movimiento.
   * Se usa al empezar una ronda y cuando se pierde en la oscuridad.
   */
  physics.respawnGlasses = function () {
    if (!glassesEl || !glassesEl.body) { return; }
    var b = glassesEl.body;
    b.wakeUp();
    b.velocity.set(0, 0, 0);
    b.angularVelocity.set(0, 0, 0);
    // El yaw con el que se creó la entidad (ver más arriba). Sin esto el
    // visor reaparece de canto en cada ronda, y el producto está elegido
    // en tres cuartos: de frente parece otra cosa.
    var yaw = new CANNON.Quaternion();
    yaw.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -16 * Math.PI / 180);
    var y = restY() || (CONFIG.scene.pedestalY + 0.058);
    b.position.set(0, y, CONFIG.scene.pedestalZ);
    b.quaternion.copy(yaw);
    b.force.set(0, 0, 0);
    b.torque.set(0, 0, 0);
    glassesEl.object3D.position.set(0, y, CONFIG.scene.pedestalZ);
    glassesEl.object3D.quaternion.set(0, 0, 0, 1);
    // El Euler del object3D manda sobre su quaternion: lo dejamos
    // consistente con el cuerpo o el siguiente frame lo deshace.
    glassesEl.object3D.rotation.set(0, -16, 0);
  };

  /** ¿El visor ha caído al suelo? Se usa para el humor y el easter egg. */
  physics.isVisorGrounded = function () {
    if (!glassesEl) { return false; }
    return glassesEl.object3D.position.y < CONFIG.scene.pedestalY - 0.10;
  };

  /** Empuje suave: sirve para el impulso de "ven a buscarme". */
  physics.nudgeGlasses = function (vx, vy, vz) {
    if (!glassesEl || !glassesEl.body) { return; }
    glassesEl.body.wakeUp();
    glassesEl.body.applyImpulse(
      new CANNON.Vec3(vx || 0, vy || 0, vz || 0),
      new CANNON.Vec3(0, 0, 0)
    );
  };

  physics.dispose = function () {
    // El `step` del driver es del sistema de física, no nuestro: si lo
    // cambiamos al entrar, hay que devolverlo al salir o un `init`
    // posterior se encontraría con el parche ya puesto y el paso fijo se
    // quedaría a medias.
    if (system && system.driver && system.driver.__mvFixedStep) {
      system.driver.step = system.driver.__mvFixedStep;
      system.driver.__mvFixedStep = null;
    }
    sceneEl = null; system = null; glassesEl = null;
    pedestalEl = null; floorEl = null;
  };

  MV.physics = physics;
}(window.MV = window.MV || {}));
