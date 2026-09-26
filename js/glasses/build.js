/**
 * MetaVr · ensamblaje del visor.
 *
 * Une montura + cristal + patillas en un solo THREE.Group y calcula los
 * metadatos que necesitan el resto de sistemas (radio para el colisionador
 * compuesto, puntos de anclaje de los hotspots, ejes de la vista explotada).
 *
 * El grupo tiene su origen en el centro óptico del cristal, que es también
 * el centro de rotación natural: las gafas giran bien sobre sí mismas.
 */
(function (MV) {
  'use strict';

  var build = {};

  /**
   * @returns {{group: THREE.Group, parts: object, meta: object}}
   */
  build.build = function () {
    var dims = MV.CONFIG.dims;

    var frameRes = MV.glasses.frame.build(dims);
    var lensRes = MV.glasses.lens.build(dims, {
      halfW: frameRes.halfW, halfH: frameRes.halfH, rim: frameRes.rim
    });
    var templeRes = MV.glasses.temple.build(dims, frameRes.halfW, frameRes.halfH);

    var group = new THREE.Group();
    group.name = 'AURA-9';
    group.add(frameRes.group);
    group.add(templeRes.group);
    group.add(lensRes.group);

    /* Metadatos que otros sistemas necesitan ---------------------------- */

    var totalWidth = dims.width + dims.templeLength * 0.55;
    var totalHeight = dims.height * 2.6;

    // Puntos de anclaje de los hotspots, en espacio local.
    // Están colocados en piezas concretas para que el texto "apunte" a algo.
    var anchorY = frameRes.halfH;
    var hotspots = [
      { id: 'cristal',   label: 'CRISTAL',   p: [0, 0, dims.depth * 0.6] },
      { id: 'canal',     label: 'CANAL',     p: [-(frameRes.halfW - 0.004), anchorY * 0.55, 0.002] },
      { id: 'sensor',    label: 'SENSORES',  p: [frameRes.halfW - 0.0195, frameRes.halfH - 0.002, 0.004] },
      { id: 'patilla',   label: 'PATILLAS',  p: [frameRes.halfW + 0.020, dims.height * 0.30, -0.040] },
      { id: 'puente',    label: 'PUENTE',    p: [0, -frameRes.halfH, -0.004] }
    ];

    var meta = {
      dims: dims,
      totalWidth: totalWidth,
      totalHeight: totalHeight,
      hotspots: hotspots,
      // Caja para el colisionador de cannon.
      //
      // En Y va la media altura EXACTA del marco, sin margen. El motivo es
      // que el colisionador es lo que apoya en el pedestal, así que la media
      // altura se mide exacta, sin margen: el marco son 52 mm de alto, luego
      // halfY = 26 mm y el canto inferior queda justo en la superficie (con
      // los +4 mm de antes flotaba 4 mm). La holgura de contacto que se veía
      // no venía de aquí: venía del solver, y se resuelve en `physics.tick`.
      //
      // En Z no se puede usar la profundidad del marco (14 mm): la caja
      // tiene que tragarse también el arranque de las patillas, que se abren
      // hacia atrás.
      halfExtents: [
        (dims.width / 2) + 0.004,
        dims.height / 2,
        0.030
      ],
      // Desplazamientos para la vista explotada: eje, distancia, parte.
      explode: [
        { target: lensRes.group,    axis: 'z',   distance: 0.055 },
        { target: frameRes.group,   axis: 'z',   distance: 0.000 },
        { target: templeRes.group,  axis: 'x',   distance: 0.0    }
      ],
      lens: lensRes,
      frame: frameRes,
      temple: templeRes
    };

    build.parts = {
      group: group,
      frame: frameRes.parts,
      temple: templeRes.parts,
      lens: lensRes
    };
    build.meta = meta;
    return { group: group, parts: build.parts, meta: meta };
  };

  /** Silueta de la montura y las patillas, para el indicador de estado. */
  build.approxTriangles = function () {
    var group = build.parts.group;
    var tris = 0;
    group.traverse(function (obj) {
      if (obj.isMesh && obj.geometry && obj.geometry.index) {
        tris += obj.geometry.index.count / 3;
      } else if (obj.isMesh && obj.geometry) {
        tris += (obj.geometry.attributes.position.count) / 3;
      }
    });
    return Math.round(tris);
  };

  MV.glasses = MV.glasses || {};
  MV.glasses.build = build;
}(window.MV = window.MV || {}));
