/**
 * MetaVr · configuración central.
 * Todas las constantes "mágicas" del proyecto viven aquí.
 * Se carga como script clásico; publica en el namespace global MV.
 */
(function (MV) {
  'use strict';

  MV.CONFIG = {
    /* ------------------------------------------------------------------ *
     * Producto
     * ------------------------------------------------------------------ */
    product: {
      name: 'AURA-9',
      tagline: 'Visor de realidad virtual',
      // Voz del producto: el humor de la página sale de aquí.
      // No son datos: son strings para el motor de réplicas (ver js/quip.js).
      persona: 'Un visor con complejo de protagonista'
    },

    /* ------------------------------------------------------------------ *
     * Dimensiones reales del modelo (metros).
     * Usar escala real es lo que hace que se sienta creíble tanto en el
     * sandbox físico como cuando te lo pones en VR.
     * ------------------------------------------------------------------ */
    dims: {
      width: 0.198,      // ancho total del visor
      height: 0.052,     // alto del cristal
      depth: 0.014,      // grosor de la montura
      curvature: 0.105,  // radio del cilindro de curvatura del visor
      templeLength: 0.132,
      templeDrop: 0.042,  // cuánto caen las patillas detrás de la oreja
      templeRadius: 0.0045,
      hingeSize: [0.014, 0.020, 0.010]
    },

    /* ------------------------------------------------------------------ *
     * Escena
     * ------------------------------------------------------------------ */
    scene: {
      background: '#04060a',
      fogNear: 2.2,
      fogFar: 14,
      floorSize: 24,
      // Altura a la que "vive" el pedestal. En VR el suelo real está en y=0.
      pedestalY: 0.98,
      pedestalZ: -1.15,
      // Altura del panel de mando, pensada para leerse cómodo de pie.
      hudY: 1.15,
      hudZ: -0.85
    },

    /* ------------------------------------------------------------------ *
     * Iluminación
     * ------------------------------------------------------------------ */
    lights: {
      keyIntensity: 1.15,
      fillIntensity: 0.55,
      rimIntensity: 0.9,
      ambientIntensity: 0.42,
      shadowMapSize: 1024
    },

    /* ------------------------------------------------------------------ *
     * Paleta: futurista, minimalista, dos acentos y punto.
     * ------------------------------------------------------------------ */
    palette: {
      void: '#04060a',
      surface: '#0b1118',
      line: '#1b2733',
      cyan: '#35f2e0',
      magenta: '#ff4d9d',
      text: '#e8f1f5',
      muted: '#6b8391'
    },

    /* ------------------------------------------------------------------ *
     * Variantes de acabado del producto (showroom)
     * ------------------------------------------------------------------ */
    variants: {
      grafito: { label: 'Grafito', frame: '#161c22', accent: '#35f2e0', roughness: 0.32, metalness: 0.85 },
      nebula:  { label: 'Nébula',  frame: '#12203a', accent: '#5b8cff', roughness: 0.28, metalness: 0.80 },
      aurora:  { label: 'Aurora',  frame: '#d8dee4', accent: '#35f2e0', roughness: 0.22, metalness: 0.55 },
      onice:   { label: 'Ónice',   frame: '#08090b', accent: '#ff4d9d', roughness: 0.12, metalness: 0.95 }
    },

    /* ------------------------------------------------------------------ *
     * Física (aframe-physics-system, driver cannon)
     * ------------------------------------------------------------------ */
    physics: {
      gravity: -9.8,
      friction: 0.4,
      restitution: 0.32,
      iterations: 12,
      // Wireframes de diagnóstico. En 4.2.4 el default ya es false, pero
      // lo fijamos aquí para que nadie lo suba por curiosidad y se le
      // olvide quitarlo.
      debug: false,
      glassesMass: 0.42,
      glassesLinearDamping: 0.16,
      glassesAngularDamping: 0.42,
      ballRadius: 0.048,
      ballMass: 0.34,
      ballLinearDamping: 0.015,
      ballAngularDamping: 0.08,
      // Tope de velocidad de lanzamiento. cannon-es no tiene CCD, así que
      // un proyectil demasiado rápido atraviesa los colisionadores.
      maxThrowSpeed: 9.0,
      // Fuerza del agarre (LockConstraint). La de su ejemplo oficial es 100,
      // que se sentía floja con controllers de Quest.
      grabMaxForce: 4000
    },

    /* ------------------------------------------------------------------ *
     * Minijuego: lanzar cosas a las gafas
     * ------------------------------------------------------------------ */
    minigame: {
      balls: 10,
      rounds: 3,
      roundSeconds: 60,
      // Puntos = velocidad de impacto * este factor, con techo.
      scorePerImpact: 26,
      maxScorePerHit: 220,
      minImpactSpeed: 1.1,
      // Ventana anti-rebote: el evento `collide` se dispara muchas veces
      // mientras los cuerpos se tocan en reposo.
      hitCooldownMs: 420
    },

    /* ------------------------------------------------------------------ *
     * Rendimiento (Quest 3S es el objetivo, no el escritorio)
     * ------------------------------------------------------------------ */
    perf: {
      // Por debajo de este fps medio se activa el modo ligero.
      liteModeFps: 55,
      liteModeWindowMs: 3000,
      // Cubo de entorno para el cristal: una cara completa cada N frames.
      cubeSize: 128,
      cubeRefreshFrames: 20,
      // Presupuesto de draw calls; se avisa en consola si se supera.
      drawCallBudget: 110
    },

    /* ------------------------------------------------------------------ *
     * Filtro óptico
     * ------------------------------------------------------------------ */
    optical: {
      tint: '#0a1a22',
      opacity: 0.46,
      refraction: 0.34,   // cuánto deforma el cubemap
      aberration: 0.055,  // aberración cromática en el borde
      fresnelPower: 2.6,
      rimBoost: 1.5,
      // Viñeta + tinte del modo "me las pongo".
      wearTint: '#0d2029',
      wearOpacity: 0.32,
      wearVignette: 0.55
    },

    /* ------------------------------------------------------------------ *
     * Easter eggs
     * ------------------------------------------------------------------ */
    easter: {
      // Ponerse las gafas N veces seguidas.
      wearStreakGoal: 3,
      // Impactos seguidos sin soltar el agarre.
      juggleGoal: 12,
      // Girar la montura 360° mientras está en el aire.
      spinGoal: 620
    },

    /* ------------------------------------------------------------------ *
     * Textos de la interfaz 3D
     * ------------------------------------------------------------------ */
    ui: {
      hudWidth: 1.35,
      hudHeight: 0.26,
      buttons: [
        { id: 'showroom', label: 'SHOWROOM' },
        { id: 'lanzacosas', label: 'LANZACOSAS' },
        { id: 'ponerselas', label: 'PONÉRSELAS' },
        { id: 'easter', label: '???' }
      ],
      help: {
        xr: 'MIRAR: Tocar  ·  AGARRAR: Gatillo  ·  LANZAR: Soltar en movimiento'
      }
    }
  };
}(window.MV = window.MV || {}));
