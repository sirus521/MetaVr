/**
 * MetaVr · escena.
 *
 * Monta lo que no es el producto: cámara, luces, niebla, el banco de fondos
 * y el punto de referencia de la mano.
 *
 * Dos decisiones que conviene dejar escritas:
 *
 * 1. No usamos `look-controls`. En VR la cámara la conduce el HMD y los
 *    controles hacen orbit; en 2D la cámara orbita con el ratón. Un solo
 *    objeto de cámara con el que alternamos entre XR y orbit evita el
 *    clásico "a veces el ratón mueve la cámara y a veces no".
 *
 * 2. El punto de mano es una entidad, no el controlador. En VR la mueve
 *    `lasthands`; en 2D la movemos nosotros desde el ratón. Así el agarre
 *    tiene un único origen de verdad en los dos modos.
 */
(function (MV) {
  'use strict';

  var util = MV.util;
  var CONFIG = MV.CONFIG;
  var stage = {};

  var el = null;
  var camera = null;
  var cameraEl = null;
  var orbit = null;
  var handEl = null;
  var lights = null;
  var backdrop = null;
  var sky = null;
  var isXR = false;
  var xrSession = null;
  var envTarget = null;      // resultado del PMREM: entorno para los metales

  /* ------------------------------------------------------------------ *
   * Cielo
   * ------------------------------------------------------------------ */

  /**
   * El `background` de A-Frame es un color plano. Para un degradado limpio
   * usamos una esfera invertida con un canvas: geometría mínima y evita que
   * el fondo parezca una pared de color sólido.
   */
  function buildSky() {
    var tex = util.canvasTexture(16, 256, function (ctx, w, h) {
      var grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0.00, '#000204');
      grad.addColorStop(0.40, CONFIG.palette.void);
      grad.addColorStop(0.70, '#06101a');
      grad.addColorStop(0.90, '#0b1c24');
      grad.addColorStop(1.00, '#123038');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    });

    var mat = new THREE.MeshBasicMaterial({
      map: tex, side: THREE.BackSide, fog: false, depthWrite: false
    });
    var dome = new THREE.Mesh(new THREE.SphereGeometry(28, 20, 14), mat);
    dome.name = 'cielo';
    dome.renderOrder = -1;
    return dome;
  }

  /* ------------------------------------------------------------------ *
   * Luces
   * ------------------------------------------------------------------ */

  function buildLights() {
    var L = CONFIG.lights;
    var group = new THREE.Group();
    group.name = 'luces';

    // Key: la única con sombra. En un Quest cada sombra extra es una
    // pasada de render completa y se nota en el frame time.
    var key = new THREE.DirectionalLight(0xffffff, L.keyIntensity);
    key.position.set(0.75, 1.7, 0.95);
    key.castShadow = true;
    key.shadow.mapSize.set(L.shadowMapSize, L.shadowMapSize);
    // Frustum ajustado al pedestal: uno enorme desperdicia resolución
    // del mapa y deja la sombra borrosa justo donde se mira.
    key.shadow.camera.near = 0.4;
    key.shadow.camera.far = 6;
    key.shadow.camera.left = -0.9;
    key.shadow.camera.right = 0.9;
    key.shadow.camera.top = 0.9;
    key.shadow.camera.bottom = -0.9;
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.014;
    key.shadow.radius = 2;
    key.target.position.set(0, CONFIG.scene.pedestalY, CONFIG.scene.pedestalZ);
    group.add(key, key.target);

    // Fill: rebote del acento por la izquierda, sin sombra.
    var fill = new THREE.DirectionalLight(
      new THREE.Color(CONFIG.palette.cyan), L.fillIntensity);
    fill.position.set(-1.2, 0.55, 0.45);
    group.add(fill);

    // Rim: contraluz magenta. Es lo que dibuja la silueta contra el fondo.
    var rim = new THREE.DirectionalLight(
      new THREE.Color(CONFIG.palette.magenta), L.rimIntensity);
    rim.position.set(-0.35, 0.95, -1.5);
    group.add(rim);

    var ambient = new THREE.AmbientLight(0x8fb6c4, L.ambientIntensity);
    group.add(ambient);

    //environment: no usamos un HDRI (sería otro fichero binario), pero sí
    // un entorno procedural muy barato para que los metales tengan algo
    // que reflejar y no se vean planos.
    var envScene = buildEnvSource();
    var pmrem = new THREE.PMREMGenerator(el.renderer);
    envTarget = pmrem.fromScene(envScene, 0.04);
    el.object3D.environment = envTarget.texture;
    // fromScene ya ha horneado la textura: el generador y los materiales
    // de origen ya no hacen falta y ocupan memoria de la GPU.
    pmrem.dispose();
    envScene.traverse(function (o) {
      if (o.isMesh && o.material) { o.material.dispose(); }
    });

    return { key: key, fill: fill, rim: rim, ambient: ambient, group: group, env: envTarget };
  }

  /** Escena mínima con las luces que feedea el PMREM. */
  function buildEnvSource() {
    var s = new THREE.Scene();
    s.add(new THREE.AmbientLight(0x334b57, 1.0));
    var cyan = new THREE.DirectionalLight(new THREE.Color(CONFIG.palette.cyan), 2.4);
    cyan.position.set(1, 1, 1);
    s.add(cyan);
    var mag = new THREE.DirectionalLight(new THREE.Color(CONFIG.palette.magenta), 1.4);
    mag.position.set(-1, 0.4, -1);
    s.add(mag);
    // Un par de planos brillantes: los metales necesitan algo con
    // contraste, no solo color plano.
    [[2, 0.5, 0x35f2e0, 0], [-2, 0.5, 0xff4d9d, 1]].forEach(function (d) {
      var m = new THREE.Mesh(
        new THREE.PlaneGeometry(1.4, 1.4),
        new THREE.MeshBasicMaterial({ color: d[2] })
      );
      m.position.set(d[0], d[1], 0);
      m.lookAt(0, 0, 0);
      s.add(m);
    });
    return s;
  }

  /* ------------------------------------------------------------------ *
   * Banco de fondos
   * ------------------------------------------------------------------ */

  /**
   * Tres lienzos que rotan con fundido. Da sensación de que el visor tiene
   * vida sin gastar ni una petición de red.
   */
  function buildBackdrop() {
    var group = new THREE.Group();
    group.name = 'fondo';
    var W = 2.7, H = 1.6;
    var z = CONFIG.scene.pedestalZ - 0.8;

    var frames = [
      {
        dur: 7,
        draw: function (ctx) {
          var g = ctx.createRadialGradient(512, 350, 10, 512, 350, 460);
          g.addColorStop(0, 'rgba(53,242,224,0.36)');
          g.addColorStop(0.5, 'rgba(21,60,80,0.15)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 640);
        }
      },
      {
        dur: 6,
        draw: function (ctx) {
          // Rejilla en perspectiva falsa: profundidad sin geometría.
          ctx.strokeStyle = 'rgba(53,242,224,0.22)';
          ctx.lineWidth = 1.5;
          var horizon = 370;
          for (var i = -14; i <= 14; i++) {
            ctx.beginPath();
            ctx.moveTo(512 + i * 27, 640);
            ctx.lineTo(512 + i * 5, horizon);
            ctx.stroke();
          }
          for (var j = 0; j < 12; j++) {
            var t = j / 11;
            var y = horizon + Math.pow(t, 2.2) * (640 - horizon);
            ctx.globalAlpha = 1 - t * 0.85;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1024, y); ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
      },
      {
        dur: 8,
        draw: function (ctx) {
          ctx.lineWidth = 2;
          for (var r = 22; r < 360; r += 36) {
            ctx.strokeStyle = 'rgba(255,77,157,' + (0.30 * (1 - r / 400)).toFixed(3) + ')';
            ctx.beginPath();
            ctx.arc(512, 320, r, 0.55, 2.25);
            ctx.stroke();
          }
        }
      }
    ];

    var planes = frames.map(function (f, i) {
      var tex = util.canvasTexture(1024, 640, function (ctx) {
        ctx.clearRect(0, 0, 1024, 640);
        f.draw(ctx);
      });
      var mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(W, H),
        new THREE.MeshBasicMaterial({
          map: tex, transparent: true, opacity: 0, depthWrite: false, fog: false
        })
      );
      mesh.name = 'fondo-' + i;
      mesh.position.set(0, CONFIG.scene.pedestalY + 0.20, z);
      mesh.userData.dur = f.dur;
      group.add(mesh);
      return mesh;
    });

    return { group: group, planes: planes, total: 21, t: 0 };
  }

  /* ------------------------------------------------------------------ *
   * Cámara
   * ------------------------------------------------------------------ */

  /**
   * La única cámara de la escena. Se crea aquí a mano en vez de dejar que
   * `<a-scene>` ponga la suya para que el HUD 3D tenga un sitio estable
   * donde colgarse (padre de cámara) y para que el control orbital tenga un
   * único objetivo.
   *
   * fov/near/far van DENTRO del atributo `camera`: son propiedades de ese
   * componente. Puestos como atributos sueltos de la entidad, A-Frame los
   * ignora y te quedas con los valores por defecto (fov 50, near 0.005,
   * far 10000) sin ningún aviso.
   */
  function buildCamera() {
    cameraEl = util.entity({
      id: 'camara',
      camera: 'fov: 55; near: 0.01; far: 60',
      position: '0 1.34 ' + (CONFIG.scene.pedestalZ + 1.6)
    });
    el.appendChild(cameraEl);
    return cameraEl;
  }

  /* ------------------------------------------------------------------ *
   * Punto de mano
   * ------------------------------------------------------------------ */

  /**
   * Esfera con halo. Es el punto donde ocurre el agarre, y en 2D lo
   * movemos con el ratón para que el fallback se parezca al gesto real.
   */
  function buildHand() {
    handEl = util.entity({ id: 'mano', 'position': '0 1.1 0' });
    el.appendChild(handEl);

    var dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.006, 12, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(CONFIG.palette.cyan) })
    );
    dot.name = 'punto';
    handEl.setObject3D('punto', dot);

    // El halo se construye con materials.holo() porque "mv-holo" es un
    // shader, no un componente: puesto como atributo tal cual, A-Frame se
    // lo guarda como atributo desconocido y la entidad se queda sin
    // geometría y sin material, o sea invisible.
    var haloEl = MV.materials.holo({
      width: 0.055,
      height: 0.055,
      color: CONFIG.palette.cyan,
      opacity: 0.55,
      power: 2.4,
      speed: 0.9,
      position: '0 0 0',
      rotation: '-90 0 0'
    });
    haloEl.id = 'halo-mano';
    handEl.appendChild(haloEl);
    return handEl;
  }

  /* ------------------------------------------------------------------ *
   * XR
   * ------------------------------------------------------------------ */

  function onEnterVR() {
    isXR = true;
    xrSession = el.renderer.xr.getSession();
    // El control orbital y el HMD se pelean por la cámara: dentro de la
    // sesión solo manda el visor. setEnabled, no `enabled`: el flag de
    // orbit2d es privado a propósito.
    if (orbit) { orbit.setEnabled(false); }
    handEl.setAttribute('lasthands', '');
  }

  function onExitVR() {
    isXR = false;
    xrSession = null;
    if (orbit) { orbit.setEnabled(true); }
    handEl.removeAttribute('lasthands');
  }

  /* ------------------------------------------------------------------ *
   * API
   * ------------------------------------------------------------------ */

  stage.build = function (sceneEl, orbitControls) {
    el = sceneEl;
    orbit = orbitControls || null;

    buildCamera();
    camera = cameraEl.object3D;

    sky = buildSky();
    el.object3D.add(sky);

    lights = buildLights();
    el.object3D.add(lights.group);

    backdrop = buildBackdrop();
    el.object3D.add(backdrop.group);

    buildHand();

    el.addEventListener('enter-vr', onEnterVR);
    el.addEventListener('exit-vr', onExitVR);

    el.sceneEl = el;
    stage.el = el;
    stage.camera = camera;
    stage.cameraEl = cameraEl;
    stage.handEl = handEl;
    stage.lights = lights;
    stage.backdrop = backdrop;

    util.log('Escena montada.');
    return stage;
  };

  stage.isXR = function () { return isXR; };
  stage.session = function () { return xrSession; };
  stage.hand = function () { return handEl; };
  stage.handObject = function () { return handEl ? handEl.object3D : null; };

  /**
   * Mueve el punto de mano siguiendo al ratón, proyectando sobre un plano
   * frontal a la altura del producto. Solo tiene efecto fuera de VR.
   */
  stage.moveHandFromPointer = function (clientX, clientY) {
    if (isXR || !handEl || !camera) { return; }
    var ndc = util.screenToNdc(clientX, clientY, el);
    if (!ndc) { return; }
    var ray = new THREE.Raycaster();
    camera.getWorldPosition(ray.ray.origin);
    ray.ray.direction.set(ndc.x, ndc.y, 0.5).unproject(camera)
      .sub(ray.ray.origin).normalize();

    // Plano a 90 cm de la cámara: bastante cerca para que el punto sea
    // alcanzable, bastante lejos para no clippingear.
    var plane = new THREE.Plane();
    var forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    plane.setFromNormalAndCoplanarPoint(forward, ray.ray.origin.clone().addScaledVector(forward, 0.9));
    var hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) { return; }
    handEl.object3D.position.copy(hit);
  };

  /**
   * Enfoque suave: acerca la cámara al producto conservando el ángulo actual.
   * El amortiguado lo pone orbit2d, aquí solo calculamos a dónde ir.
   */
  stage.focusOn = function (point, distance) {
    if (isXR || !orbit || !camera) { return; }
    var dir = camera.position.clone().sub(orbit.target()).normalize();
    orbit.focusOn(point, point.clone().add(dir.multiplyScalar(distance || 0.7)));
  };

  /** Aleja la cámara: el "reset" del HUD. */
  stage.resetView = function () {
    if (isXR || !orbit) { return; }
    orbit.reset();
  };

  stage.tick = function (dt) {
    if (backdrop) {
      backdrop.t += dt;
      var t = backdrop.t % backdrop.total;
      var acc = 0;
      for (var i = 0; i < backdrop.planes.length; i++) {
        var p = backdrop.planes[i];
        var into = t - acc;
        var out = acc + p.userData.dur - t;
        // 0.8 s de fundido en cada cambio: sin cortes duros.
        p.material.opacity = Math.max(0, Math.min(1, into / 0.8)) *
                             Math.max(0, Math.min(1, out / 0.8));
        acc += p.userData.dur;
      }
    }
    if (orbit) { orbit.tick(dt); }
  };

  stage.dispose = function () {
    if (el) {
      el.removeEventListener('enter-vr', onEnterVR);
      el.removeEventListener('exit-vr', onExitVR);
    }
    if (envTarget) { envTarget.dispose(); envTarget = null; }
    el = null; camera = null; cameraEl = null; handEl = null;
    lights = null; backdrop = null; sky = null; orbit = null;
  };

  MV.stage = stage;
}(window.MV = window.MV || {}));
