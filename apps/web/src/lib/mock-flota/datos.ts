import { avancesDeParadas, trazoVisibleDe } from './geometria';
import type { LineaMock, LineaMockId, ParadaMock, TrufiMock } from './tipos';

/**
 * Datos fijos del mock de flota — Decisión 4 del plan.
 *
 * **Z12**: la polilínea sale de los waypoints reales de
 * `scripts/data/z12-circuito/{subida,bajada}_simp.json` (los mismos que usa
 * `scripts/cargar-circuito-z12.ts` para el circuito real Villa Armonía → Univalle → Salomón
 * → Villa Armonía), convertidos de `[lon, lat]` (GeoJSON) a `[lat, lng]` y submuestreados
 * (cada ~12 vértices) para no cargar cientos de puntos en un mock. El tramo Univalle→Salomón
 * no tiene traza GPS real (ver comentario en `cargar-circuito-z12.ts`), así que acá también
 * se interpola en línea recta, igual que hace el script real.
 *
 * **Línea 120**: la polilínea sale de `GEOMETRIA_DEMO` en `packages/db/prisma/seed.ts`
 * (~L724), que es la traza real generada con OSRM sobre calles de Cochabamba para
 * `geometria120Ida()` (Plaza Colón → La Cancha). El mock la recorre de ida y de vuelta sobre
 * la misma traza para cerrar el loop (no hay geometría de retorno real por otra calle).
 *
 * Las paradas de ambas líneas usan coordenadas reales de `puntos-control.json` (Z12) y
 * `PUNTOS_120_IDA` (seed.ts) — los NOMBRES son inventados (no hay nombres de parada en la
 * base real), salvo Villa Armonía / Univalle / Salomón (Z12, documentados) y Plaza Colón /
 * La Cancha (120, en la descripción de la línea real).
 */

const Z12_POLILINEA: [number, number][] = [
  [-17.438919, -66.15053], [-17.441316, -66.151994], [-17.43941, -66.152978], [-17.436557, -66.153415],
  [-17.43286, -66.153617], [-17.429476, -66.153904], [-17.429997, -66.151266], [-17.427524, -66.153039],
  [-17.424311, -66.15383], [-17.42104, -66.153111], [-17.418008, -66.151594], [-17.414644, -66.151368],
  [-17.411305, -66.150955], [-17.409165, -66.149034], [-17.407195, -66.146146], [-17.404269, -66.145976],
  [-17.401712, -66.147746], [-17.398361, -66.148516], [-17.395071, -66.149158], [-17.391511, -66.149907],
  [-17.391472, -66.152953], [-17.389986, -66.154885], [-17.386871, -66.156247], [-17.384208, -66.158224],
  [-17.381337, -66.160089], [-17.377833, -66.16108], [-17.374821, -66.161931], [-17.371319, -66.162962],
  [-17.368087, -66.164039], [-17.36588, -66.167175], [-17.365892, -66.170842], [-17.365584, -66.174274],
  [-17.364692, -66.177602], [-17.36298, -66.180653], [-17.360028, -66.182591], [-17.357083, -66.184438],
  [-17.35501, -66.187008], [-17.352645, -66.190007], [-17.350503, -66.19298], [-17.348858, -66.195999],
  [-17.347517, -66.199082], [-17.346149, -66.202447], [-17.344596, -66.205811], [-17.34307, -66.209191],
  [-17.341628, -66.212404], [-17.33938, -66.214418], [-17.338168, -66.217761], [-17.336965, -66.220815],
  [-17.336265, -66.224327], [-17.334158, -66.226156], [-17.333026, -66.226225], [-17.331038, -66.226461],
  [-17.329051, -66.226698], [-17.327064, -66.226934], [-17.325077, -66.22717], [-17.32309, -66.227406],
  [-17.321102, -66.227642], [-17.319115, -66.227878], [-17.321772, -66.225791], [-17.322992, -66.223539],
  [-17.325673, -66.222736], [-17.328723, -66.223469], [-17.331168, -66.220882], [-17.333743, -66.219775],
  [-17.337094, -66.220866], [-17.339284, -66.219405], [-17.340367, -66.216117], [-17.341882, -66.212353],
  [-17.343477, -66.208832], [-17.344838, -66.205656], [-17.346276, -66.202397], [-17.347775, -66.198742],
  [-17.349272, -66.195446], [-17.35104, -66.192396], [-17.353174, -66.189563], [-17.355365, -66.186691],
  [-17.357837, -66.184122], [-17.360685, -66.182417], [-17.363482, -66.180272], [-17.364966, -66.176948],
  [-17.365716, -66.173411], [-17.366103, -66.16975], [-17.366569, -66.16635], [-17.36887, -66.163812],
  [-17.37212, -66.16286], [-17.375408, -66.161849], [-17.378999, -66.160813], [-17.382282, -66.160105],
  [-17.385166, -66.157909], [-17.38812, -66.156279], [-17.39143, -66.155713], [-17.391519, -66.152641],
  [-17.39306, -66.150733], [-17.39627, -66.150306], [-17.397345, -66.148], [-17.400161, -66.147162],
  [-17.402764, -66.147304], [-17.405913, -66.145432], [-17.408272, -66.14787], [-17.410114, -66.150903],
  [-17.412944, -66.150294], [-17.415163, -66.151508], [-17.418517, -66.152051], [-17.421701, -66.153554],
  [-17.423761, -66.154677], [-17.427028, -66.154056], [-17.430505, -66.15384], [-17.434002, -66.153532],
  [-17.437425, -66.152968], [-17.438749, -66.150633],
];

/**
 * Puntos de control de cada línea (Contrato de datos, plan del guion delegado): 3-4 paradas
 * por línea con `esPuntoControl: true` y `radioToleranciaM` 50-80 — el resto de las paradas
 * queda en `false`/`0`. `avance` se precalcula UNA VEZ acá con `avanceDeParada` (`geometria.ts`),
 * reusando la polilínea ya declarada arriba — no se recalcula en cada render.
 */
const Z12_PUNTOS_CONTROL: Record<string, number> = {
  'villa-armonia': 60,
  'parada-kanata': 70,
  univalle: 55,
  salomon: 65,
};

// `orden` reasignado (ítem 0 del guion de fixes, 2026-09-27): antes se había asignado a mano y
// no seguía la posición real de cada parada a lo largo del circuito — una búsqueda estrictamente
// hacia adelante (`avancesDeParadas`) apretaba kanata/univalle/salomon en ~5% del loop porque el
// vértice global más cercano de esas 3 cae, en la polilínea real, en el orden
// univalle → salomón → molle-molle → kanata (no kanata → univalle → salomón como estaba antes).
// Reasignado ordenando por el avance de vértice-más-cercano-GLOBAL de cada parada (`avanceDeParada`,
// `geometria.ts`) — villa-armonía (origen del loop) se deja fija en `orden: 0` porque su vértice
// global más cercano cae del lado equivocado del loop (avance ≈1, no ≈0 — ver comentario de
// `avanceDeParada`). Mismos ids/nombres, solo cambia `orden`.
const Z12_PARADAS_BASE = [
  { id: 'villa-armonia', nombre: 'Villa Armonía', lat: -17.438501, lng: -66.150773, orden: 0 },
  { id: 'univalle', nombre: 'Univalle', lat: -17.333952, lng: -66.22676, orden: 1 },
  { id: 'salomon', nombre: 'Salomón', lat: -17.317419, lng: -66.228554, orden: 2 },
  { id: 'parada-molle-molle', nombre: 'Parada Molle Molle', lat: -17.344054, lng: -66.207523, orden: 3 },
  { id: 'parada-kanata', nombre: 'Parada Kanata', lat: -17.353303, lng: -66.189169, orden: 4 },
  { id: 'parada-cristo-rey', nombre: 'Parada Cristo Rey', lat: -17.366966, lng: -66.165714, orden: 5 },
  { id: 'parada-uspha-uspha', nombre: 'Parada Uspha Uspha', lat: -17.379654, lng: -66.160583, orden: 6 },
  { id: 'parada-alalay', nombre: 'Parada Alalay', lat: -17.394099, lng: -66.15075, orden: 7 },
].map((p) => ({
  ...p,
  esPuntoControl: p.id in Z12_PUNTOS_CONTROL,
  radioToleranciaM: Z12_PUNTOS_CONTROL[p.id] ?? 0,
}));

// `avancesDeParadas` (no `avanceDeParada` por parada suelta): en el circuito Z12 el vértice más
// cercano GLOBAL de una parada puede caer del lado equivocado del loop (ver comentario de
// `avanceDeParada` en `geometria.ts`) — acá se calcula una vez para las 8 paradas, en orden, así
// da monótono creciente por `orden` y Villa Armonía (orden 0) queda en avance exactamente 0.
const Z12_AVANCES = avancesDeParadas(Z12_POLILINEA, Z12_PARADAS_BASE);
const Z12_PARADAS: ParadaMock[] = Z12_PARADAS_BASE.map((p, i) => ({ ...p, avance: Z12_AVANCES[i]! }));

const L120_POLILINEA: [number, number][] = [
  [-17.385423, -66.157283], [-17.385017, -66.157584], [-17.384924, -66.157653], [-17.384894, -66.157675],
  [-17.38487, -66.157692], [-17.384856, -66.157737], [-17.384853, -66.15778], [-17.384867, -66.15783],
  [-17.384899, -66.157888], [-17.384942, -66.157941], [-17.384985, -66.157965], [-17.385026, -66.157974],
  [-17.385072, -66.157971], [-17.385086, -66.15796], [-17.385118, -66.157936], [-17.385215, -66.157861],
  [-17.385339, -66.157761], [-17.385663, -66.157508], [-17.38651, -66.156861], [-17.386605, -66.156791],
  [-17.386658, -66.156745], [-17.38703, -66.156462], [-17.387551, -66.156066], [-17.387598, -66.156053],
  [-17.387649, -66.15605], [-17.38771, -66.156049], [-17.387754, -66.156298], [-17.387878, -66.156277],
  [-17.388445, -66.156214], [-17.388719, -66.156169], [-17.388816, -66.156157], [-17.388882, -66.156146],
  [-17.389806, -66.155989], [-17.389865, -66.155978], [-17.389891, -66.155974], [-17.389909, -66.155971],
  [-17.390905, -66.1558], [-17.391912, -66.155613], [-17.391979, -66.155607], [-17.392068, -66.155589],
  [-17.392144, -66.155571], [-17.392419, -66.155511], [-17.392975, -66.155395], [-17.39301, -66.155383],
  [-17.393045, -66.155373], [-17.393581, -66.155272], [-17.394003, -66.155193], [-17.394046, -66.155185],
  [-17.39411, -66.15519], [-17.394555, -66.155102], [-17.394569, -66.155099], [-17.394591, -66.155095],
  [-17.394856, -66.155047], [-17.395035, -66.155014], [-17.395068, -66.155006], [-17.39592, -66.154837],
  [-17.396053, -66.15481], [-17.396134, -66.154794], [-17.396758, -66.15467], [-17.397192, -66.15458],
  [-17.398099, -66.154417], [-17.398223, -66.154389], [-17.398993, -66.154228], [-17.399084, -66.154206],
  [-17.39907, -66.154149], [-17.398846, -66.153193], [-17.398831, -66.153125], [-17.398736, -66.152748],
  [-17.398727, -66.15272], [-17.398707, -66.152659], [-17.398546, -66.152219], [-17.398506, -66.152079],
  [-17.398495, -66.151998], [-17.398499, -66.151842], [-17.39854, -66.151085], [-17.398596, -66.150657],
  [-17.398591, -66.150467], [-17.398553, -66.149941], [-17.399004, -66.149907], [-17.399867, -66.149849],
  [-17.399962, -66.149846], [-17.400029, -66.149783], [-17.400128, -66.149705], [-17.400468, -66.149377],
  [-17.400128, -66.149705], [-17.400029, -66.149783], [-17.399962, -66.149846], [-17.399867, -66.149849],
  [-17.399004, -66.149907], [-17.398553, -66.149941], [-17.398591, -66.150467], [-17.398596, -66.150657],
  [-17.39854, -66.151085], [-17.398499, -66.151842], [-17.398495, -66.151998], [-17.398506, -66.152079],
  [-17.398546, -66.152219], [-17.398707, -66.152659], [-17.398727, -66.15272], [-17.398736, -66.152748],
  [-17.398831, -66.153125], [-17.398846, -66.153193], [-17.39907, -66.154149], [-17.399084, -66.154206],
  [-17.398993, -66.154228], [-17.398223, -66.154389], [-17.398099, -66.154417], [-17.397192, -66.15458],
  [-17.396758, -66.15467], [-17.396134, -66.154794], [-17.396053, -66.15481], [-17.39592, -66.154837],
  [-17.395068, -66.155006], [-17.395035, -66.155014], [-17.394856, -66.155047], [-17.394591, -66.155095],
  [-17.394569, -66.155099], [-17.394555, -66.155102], [-17.39411, -66.15519], [-17.394046, -66.155185],
  [-17.394003, -66.155193], [-17.393581, -66.155272], [-17.393045, -66.155373], [-17.39301, -66.155383],
  [-17.392975, -66.155395], [-17.392419, -66.155511], [-17.392144, -66.155571], [-17.392068, -66.155589],
  [-17.391979, -66.155607], [-17.391912, -66.155613], [-17.390905, -66.1558], [-17.389909, -66.155971],
  [-17.389891, -66.155974], [-17.389865, -66.155978], [-17.389806, -66.155989], [-17.388882, -66.156146],
  [-17.388816, -66.156157], [-17.388719, -66.156169], [-17.388445, -66.156214], [-17.387878, -66.156277],
  [-17.387754, -66.156298], [-17.38771, -66.156049], [-17.387649, -66.15605], [-17.387598, -66.156053],
  [-17.387551, -66.156066], [-17.38703, -66.156462], [-17.386658, -66.156745], [-17.386605, -66.156791],
  [-17.38651, -66.156861], [-17.385663, -66.157508], [-17.385339, -66.157761], [-17.385215, -66.157861],
  [-17.385118, -66.157936], [-17.385086, -66.15796], [-17.385072, -66.157971], [-17.385026, -66.157974],
  [-17.384985, -66.157965], [-17.384942, -66.157941], [-17.384899, -66.157888], [-17.384867, -66.15783],
  [-17.384853, -66.15778], [-17.384856, -66.157737], [-17.38487, -66.157692], [-17.384894, -66.157675],
  [-17.384924, -66.157653], [-17.385017, -66.157584], [-17.385423, -66.157283],
];

const L120_PUNTOS_CONTROL: Record<string, number> = {
  'plaza-colon': 60,
  'parada-san-sebastian': 70,
  'parada-uyustus': 55,
  'la-cancha': 65,
};

const L120_PARADAS_BASE = [
  { id: 'plaza-colon', nombre: 'Plaza Colón', lat: -17.385423, lng: -66.157283, orden: 0 },
  { id: 'parada-ballivian', nombre: 'Parada Ballivián', lat: -17.384899, lng: -66.157888, orden: 1 },
  { id: 'parada-san-sebastian', nombre: 'Parada San Sebastián', lat: -17.388445, lng: -66.156214, orden: 2 },
  { id: 'parada-ayacucho', nombre: 'Parada Ayacucho', lat: -17.390905, lng: -66.1558, orden: 3 },
  { id: 'parada-aroma', nombre: 'Parada Aroma', lat: -17.393045, lng: -66.155373, orden: 4 },
  { id: 'mercado-la-pampa', nombre: 'Mercado La Pampa', lat: -17.396053, lng: -66.15481, orden: 5 },
  { id: 'parada-uyustus', nombre: 'Parada Uyustus', lat: -17.398495, lng: -66.151998, orden: 6 },
  { id: 'la-cancha', nombre: 'La Cancha', lat: -17.400468, lng: -66.149377, orden: 7 },
].map((p) => ({
  ...p,
  esPuntoControl: p.id in L120_PUNTOS_CONTROL,
  radioToleranciaM: L120_PUNTOS_CONTROL[p.id] ?? 0,
}));

// Mismo motivo que `Z12_AVANCES` arriba (la 120 es ida y vuelta, así que un vértice de la
// VUELTA puede quedar más cerca en línea recta que el de la ida real).
const L120_AVANCES = avancesDeParadas(L120_POLILINEA, L120_PARADAS_BASE);
const L120_PARADAS: ParadaMock[] = L120_PARADAS_BASE.map((p, i) => ({ ...p, avance: L120_AVANCES[i]! }));

/**
 * `trazoRuta` de cada línea — computado UNA VEZ acá (no en cada render de `en-vivo-simulado.tsx`),
 * ver comentario de `trazoVisibleDe` en `geometria.ts`. Z12 no es ida y vuelta (circuito por
 * calles distintas en cada sentido), así que `trazoVisibleDe` no detecta vértice de retorno y
 * devuelve `Z12_POLILINEA` completa sin cambios — queda acá por las dudas de que el circuito
 * real cambie a futuro, no porque haga falta hoy.
 */
export const LINEAS_MOCK: Record<LineaMockId, LineaMock> = {
  z12: {
    id: 'z12',
    nombre: 'Z12',
    color: '#2563eb',
    polilinea: Z12_POLILINEA,
    trazoRuta: trazoVisibleDe(Z12_POLILINEA),
    paradas: Z12_PARADAS,
  },
  l120: {
    id: 'l120',
    nombre: 'Línea 120',
    color: '#ffffff',
    polilinea: L120_POLILINEA,
    trazoRuta: trazoVisibleDe(L120_POLILINEA),
    paradas: L120_PARADAS,
  },
};

/**
 * 8 trufis mock: 5 de Z12 y 3 de la Línea 120 (ampliación de flota del guion delegado —
 * `docs/plan-mock-guion-delegado.md`, "Flota de 8 trufis: 5 de Z12 y 3 de la Línea 120"). Los
 * 3 primeros (`trufi-z12-1`, `trufi-z12-2`, `trufi-l120-1`) son los ORIGINALES del mock previo
 * — mismos ids, placas y fotos, sin tocar. Los 5 nuevos (`trufi-z12-{3,4,5}`,
 * `trufi-l120-{2,3}`) usan placas bolivianas inventadas (`NNNN-ABC`), nombres de conductor
 * inventados, y fotos placeholder generadas con ImageMagick (mismo estilo que `z12-2.jpg`/
 * `l120-1.jpg` — ver `public/mock/trufis/FUENTES.md`). Los números de WhatsApp son ficticios a
 * propósito (Decisión 9 del plan original — riesgo aceptado por el CTO: `wa.me` podría abrir
 * el chat de una persona real).
 */
export const TRUFIS_MOCK: TrufiMock[] = [
  {
    id: 'trufi-z12-1',
    placa: '2345-ABC',
    numeroInterno: 'Z12-07',
    conductorNombre: 'Marcelo Quiroga',
    lineaId: 'z12',
    fotoUrl: '/mock/trufis/z12-1.jpg',
    whatsapp: '59170000001',
  },
  {
    id: 'trufi-z12-2',
    placa: '3187-XZR',
    numeroInterno: 'Z12-12',
    conductorNombre: 'Ronald Fernández',
    lineaId: 'z12',
    fotoUrl: '/mock/trufis/z12-2.jpg',
    whatsapp: '59170000002',
  },
  {
    id: 'trufi-z12-3',
    placa: '4521-BQP',
    numeroInterno: 'Z12-15',
    conductorNombre: 'Freddy Choque',
    lineaId: 'z12',
    fotoUrl: '/mock/trufis/z12-3.jpg',
    whatsapp: '59170000004',
  },
  {
    id: 'trufi-z12-4',
    placa: '7893-DTM',
    numeroInterno: 'Z12-19',
    conductorNombre: 'Wilma Flores',
    lineaId: 'z12',
    fotoUrl: '/mock/trufis/z12-4.jpg',
    whatsapp: '59170000005',
  },
  {
    id: 'trufi-z12-5',
    placa: '5062-FLR',
    numeroInterno: 'Z12-23',
    conductorNombre: 'Juan Carlos Mamani',
    lineaId: 'z12',
    fotoUrl: '/mock/trufis/z12-5.jpg',
    whatsapp: '59170000006',
  },
  {
    id: 'trufi-l120-1',
    placa: '1902-JLK',
    numeroInterno: '120-04',
    conductorNombre: 'Elizabeth Torrico',
    lineaId: 'l120',
    fotoUrl: '/mock/trufis/l120-1.jpg',
    whatsapp: '59170000003',
  },
  {
    id: 'trufi-l120-2',
    placa: '6248-GNS',
    numeroInterno: '120-09',
    conductorNombre: 'Hugo Rocha',
    lineaId: 'l120',
    fotoUrl: '/mock/trufis/l120-2.jpg',
    whatsapp: '59170000007',
  },
  {
    id: 'trufi-l120-3',
    placa: '3410-HWX',
    numeroInterno: '120-11',
    conductorNombre: 'Silvia Aguilar',
    lineaId: 'l120',
    fotoUrl: '/mock/trufis/l120-3.jpg',
    whatsapp: '59170000008',
  },
];
