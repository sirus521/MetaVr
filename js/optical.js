/**
 * MetaVr · filtro óptico.
 *
 * El cristal del visor lleva un shader propio que refracta el entorno. Para
 * que tenga algo que refractar hace falta un mapa de cubo, y eso lo genera
 * una CubeCamera en el centro del visor.
 *
 * ── Por qué es seguro en WebXR ─────────────────────────────────────────
 * `CubeCamera.update()` hace su propio push/pop de render target sobre el
 * `WebGLRenderer`, así que no toca el framebuffer que está usando la sesión
 * de XR. Aun así lo rodeamos de try/catch y lo limitamos a nivel 1: si en
 * algún firmware rompiera, perdemos el efecto y lo registramos, pero la
 * sesión de VR sigue viva. Ese es el orden de prioridad.
 *
 * ── Por qué 128 px y cada 20 frames ───────────────────────────────────
 * El cubemap son 6 renders adicionales. A 128 px no se nota el escalón y
 * actualizarlo 3 veces por segundo es más que suficiente: el entorno de la
 * escena apenas cambia entre frames y el ojo no percibe un mapeo estático
 * a 3 Hz mientras se mueve.
 *
 * ── El modo "llevado" ─────────────────────────────────────────────────
 * Cuando el visor está puesto, el cristal se pone más denso y aparecen
 * viñeta y aberración. No es decoración: simula el hecho de que estás
 * mirando a través de un dispositivo que se te apoya en la cara, y es
 * lo que hace creíble el efecto en lugar de "un cristal bonito".
 */
(function (MV) {
  'use strict';

  var util = MV.util;
  var CONFIG = MV.CONFIG;
  var optical = {};

  var sceneEl = null;
  var renderer = null;
  var cubeCam = null;
  var cubeTarget = null;
  var lensMesh = null;
  var uniforms = null;
  var shaderMat = null;
  var plainMat = null;

  var frameCount = 0;
  var enabled = true;
  var broken = false;        // la CubeCamera falló: no lo reintentamos
  var worn = false;
  var wearAmount = 0;        // 0 = sobre la mesa, 1 = puesto
  var wearGoal = 0;

  /* ------------------------------------------------------------------ *
   * Construcción
   * ------------------------------------------------------------------ */

  function makeCubeCamera() {
    var size = CONFIG.perf.cubeSize;
    cubeTarget = new THREE.WebGLCubeRenderTarget(size, {
      generateMipmaps: true,
      // LinearMipmap: el cristal desenfoca por sí mismo, así que el
      // escalón entre muestras consecutive pasa a ser invisible.
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter
    });
    cubeCam = new THREE.CubeCamera(0.08, 24, cubeTarget);
    // La cámara vive dentro del visor: captura el mundo tal y como lo ve
    // alguien que llevara las gafas puestas.
    cubeCam.position.set(0, 0, 0);
    return cubeCam;
  }

  /* ------------------------------------------------------------------ *
   * Captura
   * ------------------------------------------------------------------ */

  /**
   * Intenta capturar el entorno. Un solo fallo desactiva la captura para
   * siempre: si `update()` revienta una vez, va a reventar cada 20 frames y
   * el coste en FPS no compensa ningún efecto.
   */
  function capture() {
    if (!enabled || broken || !cubeCam || !renderer) { return; }
    try {
      // Ojo: el segundo argumento tiene que ser el THREE.Scene, no el
      // elemento <a-scene>. Un elemento del DOM no es un Object3D: tiene
      // `children` que son nodos HTML, no objetos de Three, así que la
      // llamada no falla pero dibuja un cubemap completamente negro. Por eso
      // el try/catch solo no protege aquí; hay que acertar el argumento.
      cubeCam.update(renderer, sceneEl.object3D);
      uniforms.tCube.value = cubeTarget.texture;
      uniforms.useCube.value = 1;
    } catch (err) {
      broken = true;
      uniforms.useCube.value = 0;
      util.warnOnce('cubecam',
        'La captura de entorno falló; el cristal sigue shader pero sin ' +
        'reflejo del mundo. La página continúa.', err);
    }
  }

  /* ------------------------------------------------------------------ *
   * API
   * ------------------------------------------------------------------ */

  optical.init = function (el, lensParts) {
    sceneEl = el;
    renderer = el.renderer;
    lensMesh = lensParts.outer;
    shaderMat = lensParts.material;
    uniforms = lensParts.uniforms;
    plainMat = MV.materials.plainGlass();

    // El cubemap se genera aunque el filtro esté apagado: si el usuario lo
    // activa más tarde no queremos el tictac del primer frame.
    try {
      makeCubeCamera();
    } catch (err) {
      broken = true;
      util.warnOnce('cubecam-init',
        'No se pudo crear la CubeCamera; filtro óptico en modo simple.', err);
    }
    return optical;
  };

  /** El cubemap se cuelga de la escena, no del visor: así no se mueve. */
  optical.attach = function (parentEl) {
    if (cubeCam && parentEl && !cubeCam.parent) {
      // Lo movemos a la posición del visor cada tick; no puede ser hijo
      // del visor porque entonces heredaría su rotación con cada giro.
      parentEl.object3D.add(cubeCam);
    }
  };

  /**
   * El cubemap se actualiza antes de los 20 frames: primera captura ya.
   * @param {HTMLElement} [visorEl] el visor, para situar la cámara. Si no se
   *        pasa se busca por id, que es lo que hace el arranque normal.
   */
  optical.prime = function (visorEl) {
    if (!cubeCam) { return; }
    var visor = visorEl || document.getElementById('visor');
    if (visor && visor.object3D) {
      cubeCam.position.set(0, 0, 0);
      visor.object3D.localToWorld(cubeCam.position);
    }
    capture();
  };

  optical.tick = function (dt) {
    // La cámara del cubemap sigue al visor, siempre.
    if (cubeCam && lensMesh) {
      lensMesh.getWorldPosition(cubeCam.position);
    }

    frameCount += 1;
    if (frameCount % CONFIG.perf.cubeRefreshFrames === 0) { capture(); }

    // eyePos para el cálculo de Fresnel. Lo sacamos de la cámara real:
    // si usáramos el centro del visor el borde se movería al girar.
    var cam = sceneEl.camera;
    if (cam) {
      cam.getWorldPosition(uniforms.eyePos.value);
    }

    if (wearAmount !== wearGoal) {
      // Interpolación exponencial: el cambio de "puesto en la mesa" a
      // "puesto en la cara" tiene que notarse, no saltar.
      wearAmount = util.damp(wearAmount, wearGoal, 5, dt);
      if (Math.abs(wearAmount - wearGoal) < 0.002) { wearAmount = wearGoal; }
      applyWear();
    }
  };

  /* ------------------------------------------------------------------ *
   * Estado: filtro on/off y modo "llevado"
   * ------------------------------------------------------------------ */

  /**
   * Apagado no significa "material peor": el shader sigue puesto pero con
   * `useCube` a 0, así el cristal conserva el degradado procedural y el
   * barrido. Saltar al MeshStandard liso quita brillo y se nota.
   */
  optical.setEnabled = function (v) {
    enabled = !!v;
    if (uniforms) { uniforms.useCube.value = (enabled && !broken) ? 1 : 0; }
    return enabled;
  };

  optical.isEnabled = function () { return enabled && !broken; };
  optical.isBroken = function () { return broken; };

  /** Poner o quitar las gafas. Es lo que dispara el cambio de densidad. */
  optical.setWorn = function (v) {
    var next = !!v;
    if (next === worn) { return worn; }
    worn = next;
    wearGoal = next ? 1 : 0;
    return worn;
  };

  optical.isWorn = function () { return worn; };

  function applyWear() {
    var w = wearAmount;
    var O = CONFIG.optical;
    // Puesto: más opaco, más aberración, menos refracción. Todo se
    // interpola a la vez, que es lo que da la sensación de "se me ha
    // puesto delante de los ojos".
    uniforms.opacity.value = util.lerp(O.opacity, O.wearOpacity, w);
    uniforms.aberration.value = util.lerp(O.aberration, O.aberration * 3.4, w);
    uniforms.refraction.value = util.lerp(O.refraction, O.refraction * 0.45, w);
    uniforms.rimBoost.value = util.lerp(O.rimBoost, O.rimBoost * 0.55, w);
    uniforms.tint.value.set(O.tint).lerp(new THREE.Color(O.wearTint), w);
    if (uniforms.uVignette) {
      uniforms.uVignette.value = O.wearVignette * w;
    }
  }

  /** Apaga el filtro por completo y vuelve al material liso. */
  optical.usePlainMaterial = function () {
    if (lensMesh && plainMat) { lensMesh.material = plainMat; }
  };

  optical.useShaderMaterial = function () {
    if (lensMesh && shaderMat) { lensMesh.material = shaderMat; }
  };

  optical.dispose = function () {
    if (cubeTarget) { cubeTarget.dispose(); cubeTarget = null; }
    if (cubeCam && cubeCam.parent) { cubeCam.parent.remove(cubeCam); }
    cubeCam = null; lensMesh = null; uniforms = null; shaderMat = null;
    enabled = true; broken = false; worn = false;
  };

  MV.optical = optical;
}(window.MV = window.MV || {}));
