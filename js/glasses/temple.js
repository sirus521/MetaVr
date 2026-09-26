/**
 * MetaVr · patillas y bisagras.
 *
 * Dos tubos sobre curvas CatmullRom que salen del lateral del visor,
 * van hacia atrás y caen por detrás de la oreja. Terminales planos
 * para que no se metan en la cabeza.
 *
 * Puntos de control en espacio local del visor: el origen está en el
 * centro del cristal y la cara mira hacia -Z.
 */
(function (MV) {
  'use strict';

  var util = MV.util;
  var materials = MV.materials;

  var temple = {};

  temple.build = function (dims, halfW, halfH) {
    var group = new THREE.Group();
    group.name = 'patillas';
    var parts = { hinges: [], arms: [], paddles: [] };

    var L = dims.templeLength;
    var drop = dims.templeDrop;
    var r = dims.templeRadius;
    var x0 = halfW - 0.0016;   // arranca del borde del bisel
    var y0 = halfH * 0.34;     // algo por encima del centro

    [-1, 1].forEach(function (side) {
      /* ---- Bisagra ---- */
      var hs = dims.hingeSize;
      var hinge = new THREE.Mesh(new THREE.BoxGeometry(hs[0], hs[1], hs[2]), materials.hardware());
      hinge.name = 'bisagra';
      hinge.position.set(side * (x0 + hs[0] * 0.4), y0, -0.0018);
      hinge.rotation.set(0, util.rad(side * 8), 0);
      hinge.castShadow = true;
      group.add(hinge);
      parts.hinges.push(hinge);

      /* ---- Brazo ----
       * Tres tramos: sale recto hacia atrás, gira hacia dentro para
       * ajustarse a la sien y cae detrás de la oreja. */
      var points = [
        new THREE.Vector3(side * (x0 + hs[0] * 0.5), y0, -0.002),
        new THREE.Vector3(side * (x0 + L * 0.30), y0 + 0.0016, -L * 0.30),
        new THREE.Vector3(side * (x0 + L * 0.62), y0 - 0.0030, -L * 0.62),
        new THREE.Vector3(side * (x0 + L * 0.86), y0 - 0.0105, -L * 0.86),
        new THREE.Vector3(side * (x0 + L * 0.94), y0 - drop * 0.62, -L * 0.98),
        new THREE.Vector3(side * (x0 + L * 0.90), y0 - drop, -L * 1.04)
      ];
      var armGeo = util.tubeFromPoints(points, r, 30, 9);
      var arm = new THREE.Mesh(armGeo, materials.frame());
      arm.name = 'patilla';
      arm.castShadow = true;
      group.add(arm);
      parts.arms.push(arm);

      /* ---- Terminal plano ----
       * Un pequeño remate achatado. Sin él, el tubo se queda abierto y
       * además te muerde detrás de la oreja. */
      var paddleShape = new THREE.Shape(util.squirclePoints(0.0072, 0.0042, 3.4, 24));
      var paddleGeo = new THREE.ExtrudeGeometry(paddleShape, {
        depth: 0.0032, bevelEnabled: true, bevelSize: 0.0007,
        bevelThickness: 0.0007, bevelSegments: 1, curveSegments: 24
      });
      var paddle = new THREE.Mesh(paddleGeo, materials.hardware());
      paddle.name = 'terminal';
      paddle.position.set(
        side * (x0 + L * 0.90),
        y0 - drop - 0.0032,
        -L * 1.04
      );
      paddle.rotation.set(util.rad(90), 0, util.rad(side * -8));
      group.add(paddle);
      parts.paddles.push(paddle);
    });

    temple.parts = parts;
    return { group: group, parts: parts };
  };

  MV.glasses = MV.glasses || {};
  MV.glasses.temple = temple;
}(window.MV = window.MV || {}));
