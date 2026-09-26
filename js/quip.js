/**
 * MetaVr · motor de réplicas.
 *
 * El humor de la página vive aquí. Las gafas tienen voz: sarcástica, seca y
 * ligeramente pasivo-agresiva. Cada evento del juego pide una frase.
 *
 * Dos decisiones de diseño para que no canse:
 *   1. No se repite una réplica hasta agotar el grupo.
 *   2. Las primeras son "tontas" y las últimas escalan: si te siguen
 *      lanzando cosas, AURA-9 se va molestando de verdad.
 */
(function (MV) {
  'use strict';

  var GROUPS = {
    boot: [
      'Arranque completo. Por fin alguien con un visor.',
      'Buenos días. O lo que sea hoy. Da igual: buenos días.',
      'He revisado el calendario. Hoy no hay nada que hacer.',
      'Sistema listo. La sala sigue vacía. Como siempre.'
    ],

    idle: [
      '¿Esto es todo lo que traes hoy?',
      'Silencio. Uno de mis favoritos.',
      'Podría mirar mi propia nariz, pero ahí estás tú.',
      'Me aburro. Te lo advierto por si te sirve.'
    ],

    flat: [
      'Estás en una pantalla plana. Mis condolencias.',
      'Esto no es realidad virtual, ¿verdad? Se nota. Huele a mitigación.',
      'Pantalla plana: sin profundidad, sin dignidad, sin mí.'
    ],

    grabbed: [
      'Eh. Hay protocolos para esto.',
      'Otra vez. Ya casi me acostumbro.',
      'Suave, que soy caro.',
      '¿Eso es una mano o un seísmo?'
    ],

    released: [
      'Vuela.',
      'Sin correa.',
      'Buen viaje. Rezaré por el trayecto.',
      'Adiós. Vuelve pronto, que aquí me aburro.'
    ],

    dropped: [
      'Suelo. Mi lugar favorito del mundo.',
      'Otra vez el suelo. Me lo sé de memoria ya.',
      'Caer también es una técnica.'
    ],

    hit: [
      '¡Eso cuenta como agresión industrial!',
      '¡Golpe! Casi te hace daño.',
      '¡Ay! Eso ha dolido en mi honor corporativo.',
      'Felicidades: has golpeado unas gafas. Enhorabuena.'
    ],

    juggle: [
      'Doce. Me debes una licencia.',
      'Estás haciendo de esto. Nota: para.',
      'Vale, me has ganado. Por ahora.'
    ],

    wear: [
      'Ahora sí. Selección natural.',
      'Por fin me usan para lo que sirvo.',
      'Ah. Tu cara. Hola, cara.',
      'Mmm. Veo tus cejas. No las tenía preparadas.'
    ],

    unwear: [
      'Otra vez fuera. Se está bien aquí abajo.',
      'Ahora hace frío en algún sitio.',
      'Al devengo.'
    ],

    variant: [
      'Nuevo acabado. Mismo precio de siempre.',
      'Me han pintado. Ha estado bien.',
      'Otro color. Qué versatile soy.'
    ],

    filterOn: [
      'Ahora sí ves a través de mí. Pisa con cuidado.',
      'Óptica activada. El mundo se ve más bonito y probablemente falso.',
      'Esto es lo que hago. Lo demás son luces.'
    ],

    filterOff: [
      'Filtro fuera. Adiós a ver el mundo deformado.',
      'Vuelvo a ser solo un trozo de plástico.'
    ],

    showroom: [
      'Bienvenido al Degolladero Oficial. Hay que ponerlo en algún sitio.',
      'Visita guiada. No hay más visitas guiadas.',
      'Panel decorativo. Como yo antes de que me olieran.'
    ],

    gameStart: [
      'Os reto a lanzarme cosas. Mal plan, pero bueno.',
      'Empieza. Recoged las pelotas y no os astilléis la cara.'
    ],

    gameEnd: [
      'Fin. ¿Alguien ha copiado ya?',
      'Se acabó. Vuelve mañana con la misma puntería.'
    ],

    lowFps: [
      'Voy a bajar la calidad. No es por nada.',
      'Esto va lento. ¿Está usted ahí?',
      'Rendimiento: lo justo.'
    ],

    secret: [
      '¡Me has encontrado! Puedes dejar de buscar.',
      'Alguien ha leído las instrucciones. No te lo merecías.',
      'Secreto desbloqueado. No se lo cuentes a nadie, que me arruina el momento.'
    ]
  };

  var cursor = {};   // índice de la siguiente réplica disponible por grupo
  var recent = [];   // Ring buffer de las últimas frases, evita repeticiones seguidas

  var quip = {};

  /**
   * Devuelve una frase para `key`, o null si no hay grupo con ese nombre.
   * Los grupos cortos (≤3) se comportan como planos: giran sin escalar.
   */
  quip.get = function (key) {
    var pool = GROUPS[key];
    if (!pool || !pool.length) { return null; }

    var i = cursor[key] || 0;
    if (i >= pool.length) {
      // Agotado: se baraja y se reinicia el ciclo.
      pool = pool.slice();
      for (var s = pool.length - 1; s > 0; s--) {
        var r = Math.floor(Math.random() * (s + 1));
        var tmp = pool[s]; pool[s] = pool[r]; pool[r] = tmp;
      }
      i = 0;
    }

    // Evita decir dos veces seguidas la misma aunque toque repetir.
    var candidate = pool[i];
    var guard = 0;
    while (recent.indexOf(candidate) !== -1 && guard < 6) {
      i = (i + 1) % pool.length;
      candidate = pool[i];
      guard++;
    }

    cursor[key] = i + 1;
    recent.push(candidate);
    if (recent.length > 6) { recent.shift(); }
    return candidate;
  };

  /** Texto plano para el overlay 2D cuando no estamos en VR. */
  quip.plain = function (key) {
    return quip.get(key) || '';
  };

  /**
   * Dispara la réplica: la escribe en el HUD 3D y en el overlay 2D.
   * Aquí solo emitimos el evento; de escucharlo se encargan ui3d.js y hud.js.
   */
  quip.say = function (key, detail) {
    var text = quip.get(key);
    if (!text) { return null; }
    document.dispatchEvent(new CustomEvent('mv:quip', {
      detail: { key: key, text: text, extra: detail || null }
    }));
    return text;
  };

  /** Reinicia contadores. Lo usa el easter egg de "olvidar todo". */
  quip.reset = function () {
    cursor = {};
    recent = [];
  };

  MV.quip = quip;
}(window.MV = window.MV || {}));
