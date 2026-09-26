/**
 * MetaVr · cristal del visor.
 *
 * El cristal lleva un THREE.ShaderMaterial propio, no el componente
 * `material` de A-Frame, y por un motivo concreto: necesita un samplerCube
 * (el entorno capturado con una CubeCamera) y eso no se declara con el
 * `schema` de un shader de A-Frame sin pelearse con la capa de uniforms.
 * Con ShaderMaterial directo tengo control total y cero sorpresas.
 *
 * El cristal son DOS capas superpuestas:
 *   · panel exterior  -> el que ves, con refracción y aberración cromática
 *   · panel interior  -> capa óptica oscura, da profundidad al mirar a través
 *
 * Sobre la CubeCamera y por qué es segura en WebXR: cubeCamera.update()
 * hace su propio save/restore de render target, así que no toca el
 * framebuffer de XR. Aun así va envuelta en try/catch y, si en algún
 * dispositivo rompiera, optical.js la desactiva y dejamos un entorno
 * estático. Perder el efecto es aceptable; perder la sesión de VR no.
 */
(function (MV) {
  'use strict';

  var util = MV.util;

  var lens = {};

  var VERTEX = [
    'varying vec3 vWorldDir;',
    'varying vec3 vNormalW;',
    'varying vec2 vUv;',
    'void main () {',
    '  vUv = uv;',
    '  vec4 worldPos = modelMatrix * vec4(position, 1.0);',
    '  vWorldDir = worldPos.xyz;',
    '  vNormalW = normalize(mat3(modelMatrix) * normal);',
    '  gl_Position = projectionMatrix * viewMatrix * worldPos;',
    '}'
  ].join('\n');

  var FRAGMENT = [
    'uniform samplerCube tCube;',
    'uniform vec3 tint;',
    'uniform vec3 eyePos;',
    'uniform float refraction;',
    'uniform float aberration;',
    'uniform float fresnelPower;',
    'uniform float rimBoost;',
    'uniform float opacity;',
    'uniform float uVignette;',
    'uniform float useCube;',
    'varying vec3 vWorldDir;',
    'varying vec3 vNormalW;',
    'varying vec2 vUv;',

    'void main () {',
    '  vec3 viewDir = normalize(vWorldDir - eyePos);',
    '  vec3 n = normalize(vNormalW);',
    // Invertimos la normal: miramos el cristal desde el lado de la cara.
    '  float facing = abs(dot(n, viewDir));',
    '  float fres = pow(1.0 - facing, fresnelPower);',

    // Dirección de refracción: como si el cristal doblara la mirada.
    '  vec3 refr = refract(viewDir, -n, 0.66);',

    // Aberración cromática: los tres canales se muestrean con desviaciones
    // distintas, más fuerte cuanto más de canto (borde del visor).
    '  float edge = (1.0 - facing);',
    '  float amt = aberration * edge;',
    '  vec3 dirR = normalize(mix(viewDir, refr, refraction) + vec3( amt, 0.0, 0.0));',
    '  vec3 dirG = normalize(mix(viewDir, refr, refraction));',
    '  vec3 dirB = normalize(mix(viewDir, refr, refraction) + vec3(-amt, 0.0, 0.0));',

    '  vec3 env;',
    '  if (useCube > 0.5) {',
    '    env = vec3(',
    '      textureCube(tCube, dirR).r,',
    '      textureCube(tCube, dirG).g,',
    '      textureCube(tCube, dirB).b',
    '    );',
    '  } else {',
    // Fallback: gradiente procedural. Sin cubemap sigue leyéndose como
    // cristal, solo que sin el mundo detrás.
    '    float h = dirG.y * 0.5 + 0.5;',
    '    env = mix(vec3(0.03, 0.07, 0.09), vec3(0.10, 0.24, 0.28), h);',
    '  }',

    // Tintado + reflejo de borde.
    '  vec3 col = env * tint * 2.4;',
    '  col += fres * rimBoost * tint;',

    // Barrido sutil de energía en diagonal: marca que es un visor activo.
    '  float scan = sin((vUv.x * 34.0 + vUv.y * 12.0)) * 0.5 + 0.5;',
    '  col += pow(scan, 8.0) * 0.035;',

    // Viñeta: solo aparece con el visor puesto. Es lo que simula que
    // el dispositivo te tapa la visión periférica.
    '  float vig = 0.0;',
    '  if (uVignette > 0.001) {',
    '    vec2 d = vUv - 0.5;',
    '    float r = length(d) * 1.414;',
    '    vig = smoothstep(0.52, 1.0, r) * uVignette;',
    '  }',
    '  col *= (1.0 - vig);',

    '  float alpha = clamp(opacity + fres * 0.45 + vig * 0.4, 0.0, 1.0);',
    '  gl_FragColor = vec4(col, alpha);',
    '}'
  ].join('\n');

  /**
   * Crea el grupo del cristal: dos paneles curvos con el shader.
   * @param {object} dims  dimensiones del visor
   * @param {object} fit   {halfW, halfH, rim} del bisel, para no invadirlo
   */
  lens.build = function (dims, fit) {
    var group = new THREE.Group();
    group.name = 'cristal';
    var o = MV.CONFIG.optical;

    // Hueco interior del bisel, menos un pelo para no hacer z-fighting.
    var innerW = (fit.halfW - fit.rim) * 2 - 0.0012;
    var innerH = (fit.halfH - fit.rim) * 2 - 0.0012;

    var uniforms = {
      tCube: { value: null },
      tint: { value: new THREE.Color(o.tint).multiplyScalar(1.0) },
      eyePos: { value: new THREE.Vector3() },
      refraction: { value: o.refraction },
      aberration: { value: o.aberration },
      fresnelPower: { value: o.fresnelPower },
      rimBoost: { value: o.rimBoost },
      opacity: { value: o.opacity },
      uVignette: { value: 0 },
      useCube: { value: 0 }
    };

    var shaderMat = new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    /* Panel exterior: la superficie que ve el usuario. */
    var outerGeo = util.superellipsePanel({
      width: innerW, height: innerH, radius: dims.curvature,
      n: 4.4, uSeg: 56, vSeg: 20
    });
    var outer = new THREE.Mesh(outerGeo, shaderMat);
    outer.name = 'cristal-exterior';
    outer.position.z = dims.depth * 0.5 - 0.0004;
    outer.renderOrder = 2;
    group.add(outer);

    /* Panel interior: capa óptica. Material barato y opaco, sin shader.
     * Oscuro y mate, para que el cristal exterior tenga algo contra lo que
     * brillar y la escena vista a través de él no parezca un agujero. */
    var innerGeo = util.superellipsePanel({
      width: innerW * 0.985, height: innerH * 0.97, radius: dims.curvature,
      n: 4.4, uSeg: 32, vSeg: 12
    });
    var innerMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#050c11'),
      metalness: 0.2,
      roughness: 0.35,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide
    });
    var inner = new THREE.Mesh(innerGeo, innerMat);
    inner.name = 'capa-optica';
    inner.position.z = dims.depth * 0.5 - 0.0072;
    group.add(inner);

    lens.parts = {
      group: group,
      outer: outer,
      inner: inner,
      material: shaderMat,
      uniforms: uniforms
    };
    return lens.parts;
  };

  /** El panel exterior: el que se puede intercambiar por el cristal liso. */
  lens.outerMesh = function () { return lens.parts.outer; };
  lens.opticalMaterial = function () { return lens.parts.material; };
  lens.uniforms = function () { return lens.parts.uniforms; };

  MV.glasses = MV.glasses || {};
  MV.glasses.lens = lens;
}(window.MV = window.MV || {}));
