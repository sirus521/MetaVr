/**
 * MetaVr · utilidades compartidas.
 * Geometría procedural, texturas generadas por canvas, easing y helpers de DOM.
 * No depende de nada más del proyecto salvo window.THREE (lo expone A-Frame).
 */
(function (MV) {
  'use strict';

  var util = {};

  /* ================================================================== *
   * Matemáticas
   * ================================================================== */

  util.clamp = function (v, min, max) {
    return v < min ? min : (v > max ? max : v);
  };

  util.lerp = function (a, b, t) {
    return a + (b - a) * t;
  };

  /**
   * Interpolación independiente del framerate.
   * `smoothing` es la fracción de la distancia restante tras 1 segundo.
   * Imprescindible para animaciones: sin esto el motion se ve igual de rápido
   * a 60 fps que a 90 fps, solo que con menos pasos.
   */
  util.damp = function (current, target, smoothing, dt) {
    return util.lerp(current, target, 1 - Math.pow(smoothing, dt));
  };

  util.smoothstep = function (edge0, edge1, x) {
    var t = util.clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  };

  util.easeOutCubic = function (t) {
    return 1 - Math.pow(1 - t, 3);
  };

  util.easeInOutCubic = function (t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };

  /** Rebote con sobrepasamiento. Da ese "pop" característico del motion. */
  util.easeOutBack = function (t) {
    var c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };

  /** Muelle amortiguado crítico, integrado a paso fijo. Devuelve [valor, velocidad]. */
  util.spring = function (state, target, stiffness, damping, dt) {
    var step = Math.min(dt, 1 / 30);
    var force = (target - state.value) * stiffness;
    var drag = state.velocity * damping;
    state.velocity = (state.velocity + (force - drag) * step) ;
    state.value = state.value + state.velocity * step;
    return state;
  };

  util.rand = function (min, max) {
    return min + Math.random() * (max - min);
  };

  util.randInt = function (min, max) {
    return Math.floor(util.rand(min, max + 1));
  };

  util.pick = function (arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  };

  /* ================================================================== *
   * Generador pseudoaleatorio con semilla.
   * Lo uso para la rejilla del suelo: quiero que sea idéntica en cada
   * carga (si no, el suelo "hierve" al recargar y descentra la página).
   * ================================================================== */

  util.seededRandom = function (seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* ================================================================== *
   * Geometría procedural
   * ================================================================== */

  /**
   * Trama de superelipse ("squircle") en el plano XY.
   * n=2 Rombo, n=4 rectángulo redondeado, n=8 casi cuadrado.
   * Es la silueta base de todo el modelo: futurista y minimalista sin
   * depender de ningún asset externo.
   *
   * Devuelve un array de Vector2 y no un THREE.Path a propósito: eso es lo
   * que aceptan `new THREE.Shape(puntos)` y `new THREE.Path(puntos)`. Un
   * Path no es una lista de puntos, así que pasarlo ahí hace que
   * setFromPoints lea `undefined` y reviente con "Cannot read properties of
   * undefined (reading 'x')".
   */
  util.squirclePoints = function (halfW, halfH, n, steps) {
    steps = steps || 72;
    n = n || 4.4;
    var pts = [];
    var exponent = 2 / n;
    for (var i = 0; i <= steps; i++) {
      var t = (i / steps) * Math.PI * 2;
      var c = Math.cos(t);
      var s = Math.sin(t);
      var x = halfW * Math.sign(c) * Math.pow(Math.abs(c), exponent);
      var y = halfH * Math.sign(s) * Math.pow(Math.abs(s), exponent);
      pts.push(new THREE.Vector2(x, y));
    }
    return pts;
  };

  /**
   * Panel curvo con silueta de superelipse y teselado interior completo.
   *
   * Por qué no usar ShapeGeometry +holes: al doblar, solo se mueven los
   * vértices del contorno, así que el interior se ve facetado. Con una
   * rejilla (u,v) la curvatura es continua y además tengo UVs limpias.
   */
  util.superellipsePanel = function (opts) {
    var width = opts.width;
    var height = opts.height;
    var radius = opts.radius;        // radio de curvatura; Infinity = plano
    var uSeg = opts.uSeg || 56;
    var vSeg = opts.vSeg || 18;
    var n = opts.n || 4.4;
    var halfW = width / 2;
    var halfH = height / 2;

    var cols = uSeg + 1;
    var rows = vSeg + 1;
    var positions = new Float32Array(cols * rows * 3);
    var uvs = new Float32Array(cols * rows * 2);
    var indices = [];

    for (var j = 0; j < rows; j++) {
      var v = j / vSeg;
      var yN = v * 2 - 1;                        // -1 abajo .. 1 arriba

      // Semiancho del contorno de la superelipse a esta altura.
      var halfAtY = halfW * Math.pow(
        Math.max(0, 1 - Math.pow(Math.abs(yN), n)), 1 / n
      );

      for (var i = 0; i < cols; i++) {
        var u = i / uSeg;
        var xN = u * 2 - 1;                      // -1 izquierda .. 1 derecha
        var x = xN * halfAtY;
        var y = yN * halfH;

        var px, py, pz;
        if (radius === Infinity) {
          px = x; py = y; pz = 0;
        } else {
          // Curvatura cilíndrica alrededor del eje Y.
          // El signo negativo en z hace que los bordes se curven hacia la
          // cara y no se abran hacia el espectador.
          var theta = x / radius;
          px = radius * Math.sin(theta);
          py = y;
          pz = -(radius * (1 - Math.cos(theta)));
        }

        var o = (j * cols + i) * 3;
        positions[o] = px;
        positions[o + 1] = py;
        positions[o + 2] = pz;

        var t = (j * cols + i) * 2;
        uvs[t] = u;
        uvs[t + 1] = v;
      }
    }

    for (var jj = 0; jj < vSeg; jj++) {
      for (var ii = 0; ii < uSeg; ii++) {
        var a = jj * cols + ii;
        var b = a + 1;
        var c = a + cols;
        var d = c + 1;
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  };

  /**
   * Dobla una geometría (contenida en un cilindro alrededor de Y) para que
   * repose sobre un radio dado. Se usa sobre ExtrudeGeometry.
   */
  util.bendToRadius = function (geometry, radius) {
    if (!radius || !isFinite(radius)) { return geometry; }
    var pos = geometry.attributes.position;
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i);
      var theta = x / radius;
      pos.setXYZ(
        i,
        radius * Math.sin(theta),
        pos.getY(i),
        pos.getZ(i) - (radius * (1 - Math.cos(theta)))
      );
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  };

  /**
   * Abomba (domo) una geometría a lo largo de Z, con caída suave hacia los
   * bordes. Da el reflejo de primera calidad que hace que un plástico
   * rectilíneo parezca recién salido del molde.
   */
  util.domeAlongZ = function (geometry, amount, halfW, halfH) {
    if (!amount) { return geometry; }
    var pos = geometry.attributes.position;
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i) / (halfW || 1);
      var y = pos.getY(i) / (halfH || 1);
      var falloff = Math.max(0, 1 - (x * x + y * y));
      pos.setZ(i, pos.getZ(i) + amount * falloff);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  };

  /** TubeGeometry a lo largo de una curva de puntos, sin enrollar. */
  util.tubeFromPoints = function (points, radius, tubularSegments, radialSegments) {
    var curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.4);
    var geo = new THREE.TubeGeometry(
      curve,
      tubularSegments || 32,
      radius,
      radialSegments || 10,
      false
    );
    return geo;
  };

  /* ================================================================== *
   * Texturas por canvas (cero binarios en el repositorio)
   * ================================================================== */

  util.canvasTexture = function (width, height, draw) {
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d');
    draw(ctx, width, height);
    var tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    tex.anisotropy = 4;
    return tex;
  };

  /**
   * Lo mismo, pero devuelve la imagen como data URL en vez de como textura
   * de Three. Necesario para el componente `material` de A-Frame, que solo
   * acepta una URL en su propiedad `src`: darle un THREE.Texture en `map`
   * no da error de sintaxis, A-Frame lo descarta con un aviso y el suelo
   * sale liso.
   */
  util.canvasDataUrl = function (width, height, draw) {
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d');
    draw(ctx, width, height);
    return canvas.toDataURL('image/png');
  };

  /** Mapa de rugosidad con estrías horizontales: metal cepillado. */
  util.brushedRoughnessMap = function (size, base) {
    base = base === undefined ? 0.34 : base;
    return util.canvasTexture(size, size, function (ctx, w, h) {
      var rnd = util.seededRandom(20260926);
      var v = Math.round(base * 255);
      ctx.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
      ctx.fillRect(0, 0, w, h);

      // Estrías: muchas líneas horizontales tenues.
      for (var i = 0; i < h * 3; i++) {
        var y = Math.floor(rnd() * h);
        var delta = (rnd() - 0.5) * 90;
        var nv = Math.round(util.clamp(base + delta / 255, 0.04, 0.98) * 255);
        ctx.strokeStyle = 'rgba(' + nv + ',' + nv + ',' + nv + ',0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
        ctx.stroke();
      }
    });
  };

  /**
   * Rejilla técnica para el suelo. Muy futurista y muy barata.
   * El dibujo vive aparte porque hace falta en dos formatos: como textura
   * de Three (uniforms de shader) y como data URL (componente `material`).
   */
  function drawGrid(ctx, w, h, color, minorAlpha) {
    ctx.clearRect(0, 0, w, h);
    var cell = w / 8;
    ctx.strokeStyle = color;

    // Menores
    ctx.globalAlpha = minorAlpha === undefined ? 0.14 : minorAlpha;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 0; i <= 8; i++) {
      var p = i * cell + 0.5;
      ctx.moveTo(p, 0); ctx.lineTo(p, h);
      ctx.moveTo(0, p); ctx.lineTo(w, p);
    }
    ctx.stroke();

    // Mayores
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0.5, 0); ctx.lineTo(0.5, h);
    ctx.moveTo(0, 0.5); ctx.lineTo(w, 0.5);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  util.gridTexture = function (size, color, minorAlpha) {
    var tex = util.canvasTexture(size, size, function (ctx, w, h) {
      drawGrid(ctx, w, h, color, minorAlpha);
    });
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 6);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };

  /** La misma rejilla como data URL, para `material="src: ..."`. */
  util.gridDataUrl = function (size, color, minorAlpha) {
    return util.canvasDataUrl(size, size, function (ctx, w, h) {
      drawGrid(ctx, w, h, color, minorAlpha);
    });
  };

  /** Degradado radial: sombras de contacto y halos. */
  util.radialGlowTexture = function (size, inner, outer) {
    var tex = util.canvasTexture(size, size, function (ctx, w, h) {
      var g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, inner);
      g.addColorStop(0.55, outer);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };

  /* ================================================================== *
   * Helpers de escena
   * ================================================================== */

  /**
   * Convierte coordenadas de pantalla (clientX/clientY del ratón) en NDC
   * de Three, respetando el canvas de A-Frame.
   *
   * Importante: hay que usar el rect del canvas, no `window.innerWidth`.
   * En un Quest el canvas no ocupa la ventana completa, y con el viewport
   * equivocado el rayo sale disparado a otro sitio.
   *
   * @returns {THREE.Vector2|null} null si aún no hay cámara.
   */
  util.screenToNdc = function (clientX, clientY, sceneEl) {
    var scene = sceneEl || document.querySelector('a-scene');
    if (!scene || !scene.renderer || !scene.canvas) { return null; }
    var rect = scene.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) { return null; }
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
  };

  /**
   * Crea un <a-entity> con atributos.
   * Todas las entidades del proyecto se crean por aquí para mantener el
   * estilo declarativo aunque assemblemos desde JS.
   */
  util.entity = function (attrs, children) {
    var el = document.createElement('a-entity');
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        el.setAttribute(k, attrs[k]);
      });
    }
    if (children) {
      children.forEach(function (c) { el.appendChild(c); });
    }
    return el;
  };

  /** Igual que entity() pero devuelve un <a-box> con dimensiones. */
  util.box = function (w, h, d, attrs) {
    var a = attrs || {};
    a.geometry = 'primitive: box; width: ' + w + '; height: ' + h + '; depth: ' + d;
    return util.entity(a);
  };

  /**
   * Registra un componente "tick-once" para ganar legibilidad al encadenar
   * animaciones de entrada sin ensuciar el DOM con <a-animation>.
   */
  util.rad = function (deg) { return deg * Math.PI / 180; };

  /**
   * Espera a que la escena esté cargada.
   *
   * Ojo con un detalle de A-Frame: `loaded` se dispara antes de que los
   * sistemas y el renderer estén utilizables desde fuera. Por eso
   * esperamos a `renderstart`, que sí garantiza que hay un frame en
   * pantalla. main.js es quien mantiene la promesa, así varios módulos
   * pueden esperar el mismo arranque sin crear escuchas de sobra.
   */
  util.whenSceneReady = function () {
    if (util._readyPromise) { return util._readyPromise; }
    util._readyPromise = new Promise(function (resolve, reject) {
      var scene = document.querySelector('a-scene');
      if (!scene) {
        reject(new Error('No hay <a-scene> en el documento.'));
        return;
      }
      // Si ya está en pantalla, resolvemos en el siguiente tick para
      // dejar que main.js termine de registrarse.
      if (scene.hasLoaded && scene.renderer) { resolve(scene); return; }
      scene.addEventListener('renderstart', function () { resolve(scene); });
      scene.addEventListener('error', function (e) {
        reject(new Error('La escena de A-Frame falló: ' + (e.detail || 'sin detalle')));
      });
    });
    return util._readyPromise;
  };

  /* ================================================================== *
   * Diagnóstico
   * ================================================================== */

  var warned = {};

  /** Aviso una sola vez, para no inundar la consola en VR. */
  util.warnOnce = function (key, message, err) {
    if (warned[key]) { return; }
    warned[key] = true;
    if (window.console && console.warn) {
      if (err) { console.warn('[MetaVr] ' + message, err); }
      else { console.warn('[MetaVr] ' + message); }
    }
  };

  util.log = function (message) {
    if (window.console && console.log) { console.log('[MetaVr] ' + message); }
  };

  MV.util = util;
}(window.MV = window.MV || {}));
