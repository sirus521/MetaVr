/**
 * MetaVr · materiales y shader de holograma.
 *
 * Dos cosas pasan aquí:
 *   1. Una caché de materiales compartidos para no crear uno por entidad
 *      (en Quest cada material extra es una llamada de bloqueo).
 *   2. El shader 'mv-holo', registrado con AFRAME.registerShader, que es
 *      la vía idiomática cuando solo necesito uniforms de float/vec3.
 *
 * El cristal NO usa este shader: lleva samplerCube, y para eso se hace un
 * THREE.ShaderMaterial a mano en js/glasses/lens.js.
 */
(function (MV) {
  'use strict';

  var CONFIG = MV.CONFIG;
  var materials = {};

  var shared = {};        // texturas y materiales reutilizables
  var holoMaterials = []; // registry para el driver de tiempo
  var variantApplied = null;

  /* ------------------------------------------------------------------ *
   * Shader de holograma (registro idiomático en A-Frame)
   * ------------------------------------------------------------------ */

  var HOLO_VERTEX = [
    'varying vec2 vUv;',
    'varying vec3 vNormal;',
    'void main () {',
    '  vUv = uv;',
    '  vNormal = normalize(normalMatrix * normal);',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');

  var HOLO_FRAGMENT = [
    'uniform vec3 color;',
    'uniform float uTime;',
    'uniform float opacity;',
    'uniform float power;',
    'uniform float speed;',
    'uniform float edgeFade;',
    'varying vec2 vUv;',
    'varying vec3 vNormal;',
    'void main () {',
    '  // Bandas que ascienden: el "motion" base del holograma.',
    '  float wave = sin((vUv.y * power - uTime * speed) * 6.2831853) * 0.5 + 0.5;',
    '  float band = pow(wave, 3.0);',
    '  // Fresnel: el borde del panel brilla más que el centro.',
    '  float facing = abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)));',
    '  float fres = pow(1.0 - facing, 2.0);',
    // Atenuamos hacia los bordes del panel para que no se corte en seco.
    '  float edge = smoothstep(0.0, edgeFade, vUv.x) * smoothstep(0.0, edgeFade, 1.0 - vUv.x);',
    '  float alpha = opacity * (0.22 + band * 0.78) * (0.35 + edge * 0.65);',
    '  vec3 rgb = color * (0.55 + band * 1.5 + fres * 0.9);',
    '  gl_FragColor = vec4(rgb, alpha);',
    '}'
  ].join('\n');

  /** Registra el shader. Idempotente. */
  materials.registerShaders = function () {
    if (materials._shadersRegistered) { return; }
    AFRAME.registerShader('mv-holo', {
      schema: {
        color: { type: 'color', is: 'uniform' },
        opacity: { type: 'number', is: 'uniform', default: 0.65 },
        power: { type: 'number', is: 'uniform', default: 5.0 },
        speed: { type: 'number', is: 'uniform', default: 0.30 },
        edgeFade: { type: 'number', is: 'uniform', default: 0.12 },
        // uTime lo escribe mv-holo-driver cada frame.
        uTime: { type: 'number', is: 'uniform', default: 0 }
      },
      vertexShader: HOLO_VERTEX,
      fragmentShader: HOLO_FRAGMENT
    });
    materials._shadersRegistered = true;
  };

  /**
   * Crea una entidad con el shader de holograma y la registra para animación.
   *
   * `depthTest: false` desactiva el test de profundidad, que es lo que
   * necesita un HUD: sin él, el panel se esconde detrás del visor en
   * cuanto la cámara se acerca un poco. El resto de hologramas lo dejan a
   * true para que el producto los tape cuando toca.
   */
  materials.holo = function (opts) {
    materials.registerShaders();
    var o = opts || {};
    var el = document.createElement('a-entity');
    el.setAttribute('geometry', 'primitive: plane; ' +
      'width: ' + (o.width || 1) + '; height: ' + (o.height || 0.2) + ';');
    el.setAttribute('material', {
      shader: 'mv-holo',
      color: o.color || CONFIG.palette.cyan,
      opacity: o.opacity === undefined ? 0.6 : o.opacity,
      power: o.power === undefined ? 5 : o.power,
      speed: o.speed === undefined ? 0.3 : o.speed,
      transparent: true,
      depthWrite: false,
      depthTest: o.depthTest === undefined ? true : !!o.depthTest,
      side: 'double',
      blending: 'additive'
    });
    if (o.position) { el.setAttribute('position', o.position); }
    if (o.rotation) { el.setAttribute('rotation', o.rotation); }
    el.setAttribute('mv-holo-driver', '');
    return el;
  };

  /* ------------------------------------------------------------------ *
   * Texturas compartidas
   * ------------------------------------------------------------------ */

  materials.textures = function () {
    if (shared.brushed) { return shared; }
    shared.brushed = MV.util.brushedRoughnessMap(256, 0.92);
    // La rejilla se usa como mapa de color (líneas cian), así que va en
    // sRGB. El mapa de rugosidad, en cambio, se queda en NoColorSpace.
    shared.grid = MV.util.gridTexture(512, '#35f2e0', 0.16);
    shared.shadow = MV.util.radialGlowTexture(128, 'rgba(0,0,0,0.85)', 'rgba(0,0,0,0.35)');
    shared.glow = MV.util.radialGlowTexture(
      256,
      'rgba(53,242,224,0.55)',
      'rgba(53,242,224,0.10)'
    );
    return shared;
  };

  /* ------------------------------------------------------------------ *
   * Materiales del producto
   * ------------------------------------------------------------------ */

  /**
   * Montura. MeshStandardMaterial con rugosidad modulada por un mapa de
   * metal cepillado generado al vuelo: el brillo no es uniforme, y eso es
   * lo que separa "plástico" de "producto".
   */
  materials.frame = function () {
    if (shared.frame) { return shared.frame; }
    var tex = materials.textures();
    shared.frame = new THREE.MeshStandardMaterial({
      color: new THREE.Color(CONFIG.variants.grafito.frame),
      metalness: CONFIG.variants.grafito.metalness,
      roughness: CONFIG.variants.grafito.roughness,
      roughnessMap: tex.brushed,
      envMapIntensity: 0.9
    });
    return shared.frame;
  };

  /** Acento emisivo: las tiras de luz del visor. */
  materials.accent = function () {
    if (shared.accent) { return shared.accent; }
    shared.accent = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#061014'),
      emissive: new THREE.Color(CONFIG.variants.grafito.accent),
      emissiveIntensity: 2.4,
      metalness: 0.2,
      roughness: 0.4
    });
    return shared.accent;
  };

  /** Metal oscuro de bisagras, patillas y detalles. */
  materials.hardware = function () {
    if (shared.hardware) { return shared.hardware; }
    shared.hardware = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#2b333c'),
      metalness: 0.95,
      roughness: 0.28
    });
    return shared.hardware;
  };

  /** Plástico mate de las almohadillas nasales. */
  materials.silicone = function () {
    if (shared.silicone) { return shared.silicone; }
    shared.silicone = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#1a1f26'),
      metalness: 0.0,
      roughness: 0.92
    });
    return shared.silicone;
  };

  /**
   * Cristal sin filtro óptico: cristal oscuro sencillo con reflejo de
   * entorno. Es el estado por defecto y el que menos GPU gasta.
   * Cuando se activa el filtro, lens.js lo sustituye por su shader.
   */
  materials.plainGlass = function () {
    if (shared.plainGlass) { return shared.plainGlass; }
    shared.plainGlass = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#0c161c'),
      metalness: 0.1,
      roughness: 0.08,
      transparent: true,
      opacity: 0.55,
      envMapIntensity: 1.6,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    return shared.plainGlass;
  };

  /* ------------------------------------------------------------------ *
   * Variantes de acabado
   * ------------------------------------------------------------------ */

  materials.variantKeys = function () {
    return Object.keys(CONFIG.variants);
  };

  /**
   * Recolorea montura y acento en el sitio. No crea materiales nuevos:
   * muta los compartidos, así que el cambio es instantáneo y no genera
   * basura para el recolector.
   */
  materials.applyVariant = function (key) {
    var v = CONFIG.variants[key];
    if (!v) {
      MV.util.warnOnce('variant:' + key, 'Variante desconocida: ' + key);
      return false;
    }
    var frame = materials.frame();
    var accent = materials.accent();
    frame.color.set(v.frame);
    frame.roughness = v.roughness;
    frame.metalness = v.metalness;
    accent.emissive.set(v.accent);
    variantApplied = key;
    return true;
  };

  materials.currentVariant = function () { return variantApplied; };

  /** Cicla a la siguiente variante. Devuelve la nueva clave. */
  materials.nextVariant = function () {
    var keys = materials.variantKeys();
    var i = keys.indexOf(variantApplied);
    var next = keys[(i + 1) % keys.length];
    materials.applyVariant(next);
    return next;
  };

  /* ------------------------------------------------------------------ *
   * Driver del uniform de tiempo de los hologramas
   * ------------------------------------------------------------------ */

  materials.registerHoloMaterial = function (mat) {
    if (mat && holoMaterials.indexOf(mat) === -1) { holoMaterials.push(mat); }
  };

  /**
   * Da de baja un material. Sin esto, cada entidad destruida deja su
   * THREE.ShaderMaterial en la lista y el driver sigue escribiéndole el
   * tiempo cada frame, indefinidamente.
   */
  materials.unregisterHoloMaterial = function (mat) {
    var i = holoMaterials.indexOf(mat);
    if (i !== -1) { holoMaterials.splice(i, 1); }
  };

  /**
   * Componente que engancha el material de una entidad al driver de tiempo.
   *
   * No se engancha en `loaded`: el componente `material` de A-Frame se
   * inicializa de forma asíncrona, y en el momento del `loaded` de la
   * entidad todavía puede no haber material. `componentinitialized` es el
   * sitio fiable, porque se emite justo cuando el material ya existe. Y si
   * para entonces ya estaba, `material` es una dependencia declarada, así
   * que A-Frame la ha construido antes que a este componente.
   */
  AFRAME.registerComponent('mv-holo-driver', {
    dependencies: ['material'],
    init: function () {
      this._attach();
      this.onMaterial = this._attach.bind(this);
      this.el.addEventListener('componentinitialized', function (e) {
        if (e && e.detail && e.name === 'material') {
          this.onMaterial();
        }
      }.bind(this));
    },
    remove: function () {
      var mat = this._material();
      if (mat) { materials.unregisterHoloMaterial(mat); }
    },
    _material: function () {
      var attr = this.el.getAttribute('material');
      return attr && attr.material ? attr.material : null;
    },
    _attach: function () {
      var mat = this._material();
      if (!mat) { return; }
      this._registered = mat;
      materials.registerHoloMaterial(mat);
    }
  });

  materials.tick = function (seconds) {
    for (var i = 0; i < holoMaterials.length; i++) {
      var m = holoMaterials[i];
      if (m.uniforms && m.uniforms.uTime) { m.uniforms.uTime.value = seconds; }
    }
  };

  /** Vacía la caché. Se usa al apagar la calidad (modo ligero). */
  materials.dispose = function () {
    Object.keys(shared).forEach(function (k) {
      var o = shared[k];
      if (o && o.dispose) { o.dispose(); }
    });
    shared = {};
    holoMaterials = [];
  };

  MV.materials = materials;
}(window.MV = window.MV || {}));
