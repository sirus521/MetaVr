/**
 * MetaVr · montura.
 *
 * Todo sale de una superelipse: una Shape con un agujero interior, extruida
 * y luego curvada sobre un cilindro. El resultado es una visera continua
 * (no dos "_gafas_" sueltas) que encaja con el estilo futurista minimalista
 * y cuesta unos miles de triángulos.
 *
 * Convención de ejes: X ancho, Y alto, Z hacia el espectador (+Z).
 * La cara del usuario está en -Z.
 */
(function (MV) {
  'use strict';

  var util = MV.util;
  var materials = MV.materials;

  var frame = {};

  /**
   * Construye un anillo extruido (Shape con hole) ya curvado y abombado.
   * Lo reutilizan la montura exterior y el canal de acento.
   */
  function buildRing(opts) {
    var shape = new THREE.Shape(util.squirclePoints(opts.halfW, opts.halfH, opts.n, opts.steps));
    var hole = new THREE.Path(util.squirclePoints(
      opts.halfW - opts.rim, opts.halfH - opts.rim, opts.n, opts.steps
    ));
    shape.holes.push(hole);

    var geo = new THREE.ExtrudeGeometry(shape, {
      depth: opts.depth,
      bevelEnabled: true,
      bevelThickness: opts.bevel || 0.0011,
      bevelSize: opts.bevel || 0.0011,
      bevelOffset: 0,
      bevelSegments: 2,
      curveSegments: opts.steps
    });

    // ExtrudeGeometry va de z=0 a z=depth; centramos antes de deformar.
    geo.translate(0, 0, -opts.depth / 2);
    util.bendToRadius(geo, opts.radius);
    util.domeAlongZ(geo, opts.dome || 0, opts.halfW, opts.halfH);
    geo.computeVertexNormals();
    return geo;
  }

  frame.buildRing = buildRing;

  /**
   * Devuelve el grupo de la montura con todas sus piezas.
   * `name` se usa en la vista explotada y en los hotspots.
   */
  frame.build = function (dims) {
    var group = new THREE.Group();
    group.name = 'montura';
    var parts = {};

    var halfW = dims.width / 2;
    var halfH = dims.height / 2;
    var rim = 0.0062;                 // grosor del bisel (6.2 mm)
    var n = 4.4;

    /* ---------------- Bisel exterior ---------------- */
    var outerGeo = buildRing({
      halfW: halfW, halfH: halfH, n: n, rim: rim,
      depth: dims.depth, radius: dims.curvature,
      dome: 0.0022, steps: 48
    });
    parts.frameMesh = new THREE.Mesh(outerGeo, materials.frame());
    parts.frameMesh.name = 'bisel';
    parts.frameMesh.castShadow = true;
    parts.frameMesh.receiveShadow = true;
    group.add(parts.frameMesh);

    /* ---------------- Canal de acento emisivo ----------------
     * Un anillo más fino y ligeramente retranqueado. Al seguir la misma
     * curvatura, dibuja una línea de luz continua alrededor del visor:
     * el detalle que más "futurista" lee a distancia. */
    var channelGeo = buildRing({
      halfW: halfW - 0.0072, halfH: halfH - 0.0060, n: n, rim: 0.0016,
      depth: dims.depth * 0.55, radius: dims.curvature,
      dome: 0.0016, bevel: 0.0004, steps: 48
    });
    parts.accentMesh = new THREE.Mesh(channelGeo, materials.accent());
    parts.accentMesh.name = 'acento';
    group.add(parts.accentMesh);

    /* ---------------- Puente nasal ---------------- */
    // Mitad inferior del anillo, engrosada: sostiene el visor y le da
    // asimetría (manda más abajo que arriba, como debe ser).
    var bridgeGeo = buildRing({
      halfW: halfW * 0.62, halfH: halfH * 0.30, n: 5.2, rim: 0.0038,
      depth: dims.depth * 0.9, radius: dims.curvature,
      dome: 0.0012, bevel: 0.0008, steps: 40
    });
    parts.bridgeMesh = new THREE.Mesh(bridgeGeo, materials.frame());
    parts.bridgeMesh.name = 'puente';
    parts.bridgeMesh.position.set(0, -halfH + 0.0012, -0.0016);
    parts.bridgeMesh.castShadow = true;
    group.add(parts.bridgeMesh);

    /* ---------------- Almohadillas nasales ---------------- */
    var padShape = new THREE.Shape(
      util.squirclePoints(0.0062, 0.0090, 3.0, 24)
    );
    var padGeo = new THREE.ExtrudeGeometry(padShape, {
      depth: 0.0042, bevelEnabled: true, bevelSize: 0.0008,
      bevelThickness: 0.0008, bevelSegments: 1, curveSegments: 24
    });
    parts.pads = [];
    [-1, 1].forEach(function (side) {
      var pad = new THREE.Mesh(padGeo, materials.silicone());
      pad.name = 'almohadilla';
      pad.position.set(side * 0.0092, -halfH - 0.0028, -0.0075);
      pad.rotation.set(util.rad(66), util.rad(side * 16), util.rad(side * -12));
      group.add(pad);
      parts.pads.push(pad);
    });

    /* ---------------- Módulos de sensor ----------------
     * Dos bloques en las esquinas superiores con un punto emisivo.
     * Dan escala de producto real y sirven de hotspot natural. */
    parts.sensors = [];
    [-1, 1].forEach(function (side) {
      var podGeo = new THREE.BoxGeometry(0.0135, 0.0105, 0.0075);
      var pod = new THREE.Mesh(podGeo, materials.hardware());
      pod.name = 'sensor';
      // Colocados sobre el borde superior y algo retranqueados.
      pod.position.set(side * (halfW - 0.0195), halfH - 0.0018, -0.0040);
      pod.rotation.set(util.rad(-8), util.rad(side * -17), 0);
      pod.castShadow = true;
      group.add(pod);

      var dotGeo = new THREE.CircleGeometry(0.0021, 16);
      var dot = new THREE.Mesh(dotGeo, materials.accent());
      dot.name = 'lente-sensor';
      dot.position.set(side * (halfW - 0.0195), halfH - 0.0018, 0.0002);
      dot.rotation.set(0, util.rad(side * -17), 0);
      group.add(dot);

      parts.sensors.push(pod);
      parts.sensors.push(dot);
    });

    frame.parts = parts;
    return { group: group, parts: parts, halfW: halfW, halfH: halfH, rim: rim };
  };

  MV.glasses = MV.glasses || {};
  MV.glasses.frame = frame;
}(window.MV = window.MV || {}));
