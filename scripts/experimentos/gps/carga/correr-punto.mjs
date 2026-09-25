#!/usr/bin/env node
// Corre UN punto de la matriz: generador.mjs (escritura) + lecturas.mjs (lectura K=20) EN
// PARALELO contra el contenedor `quivo-carga-pg` ya levantado, muestrea `docker stats`
// durante la ventana medida, y evalúa PASA/FALLA/INVALIDA (docs/plan-experimento-puntos-gps.md §5):
//   FALLA si throughput < 95% del objetivo, o p95 del lote > 1500ms, o filasPerdidas > 0,
//   o el backlog no drena tras el drenado con deadline (ver `generador.mjs`, `sostenido`).
//   INVALIDA (hallazgo 8 de revisión, 2026-09-22) si, además de los procesos requeridos
//   fallando o sin resultado, con K>0 CUALQUIER tipo de lectura (listarHoy/obtenerPosiciones/
//   obtenerTraza) tiene tasa de error > 1% o cero lecturas exitosas propias — antes solo se
//   detectaba el caso extremo de los 3 tipos en cero, un tipo con errores intermitentes pero
//   algún éxito pasaba como PASA sin que nada lo marcara.
//
// Modo remoto (docs/plan-experimento-puntos-gps.md §10): con QUIVO_CARGA_DATABASE_URL
// seteada, NO hay contenedor Docker que muestrear — el CPU real de la instancia se mide
// aparte con `cloudsql/metricas.sh` (Cloud Monitoring), así que este script se salta
// `docker stats` (cpuPromedioPct/cpuMaxPct quedan `null`, con nota). La concurrencia del
// generador (1 en local, fiel a BullMQ default) se vuelve parametrizable vía
// `QUIVO_CARGA_CONCURRENCIA` para compensar la latencia de red en remoto (8 y 16, ver
// RUNBOOK) — en local, sin la env seteada, sigue siendo 1 (mismo comportamiento que antes).
//
// Uso: node correr-punto.mjs <perfil> <objetivo> <syncS> <duracionS> <K> <salidaJson>
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { ES_REMOTO } from './lib/pg.mjs';

const [, , PERFIL, OBJETIVO, SYNC_S, DURACION_S, K, SALIDA] = process.argv;
const CONTENEDOR = 'quivo-carga-pg';
const CALENTAMIENTO = Number(process.env.QUIVO_CARGA_CALENTAMIENTO ?? 60);
const CONCURRENCIA_GENERADOR = process.env.QUIVO_CARGA_CONCURRENCIA ?? '1';

function correr(cmd, args, salidaLog) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => {
      if (salidaLog) writeFileSync(salidaLog, out + '\n---stderr---\n' + err);
      resolve({ code, out, err });
    });
  });
}

async function muestrearDockerStats(duracionTotalMs) {
  const muestras = [];
  const inicio = Date.now();
  while (Date.now() - inicio < duracionTotalMs) {
    const r = await correr('docker', [
      'stats',
      '--no-stream',
      '--format',
      '{{.CPUPerc}}\t{{.MemUsage}}',
      CONTENEDOR,
    ]);
    const linea = r.out.trim().split('\n')[0];
    if (linea) {
      const [cpu, mem] = linea.split('\t');
      muestras.push({ t: Date.now() - inicio, cpu: cpu?.trim(), mem: mem?.trim() });
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
  return muestras;
}

async function main() {
  const generadorSalida = SALIDA.replace('.json', '.generador.json');
  const lecturasSalida = SALIDA.replace('.json', '.lecturas.json');
  const statsSalida = SALIDA.replace('.json', '.docker-stats.json');

  console.error(
    `>>> Punto: perfil=${PERFIL} objetivo=${OBJETIVO}pts/s sync=${SYNC_S}s K=${K} duracion=${DURACION_S}s ` +
      `calentamiento=${CALENTAMIENTO}s concurrencia=${CONCURRENCIA_GENERADOR} remoto=${ES_REMOTO}`,
  );

  // Borrar resultados de una corrida anterior de ESTE MISMO punto (mismo SALIDA — un rerun
  // reusa el path) ANTES de lanzar los hijos. Sin esto, si el hijo de esta corrida falla
  // ANTES de escribir su propio JSON (crash temprano, conexión caída, etc.), el
  // `readFileSync` de más abajo leería felizmente el archivo que dejó la corrida anterior
  // (posiblemente exitosa) y el resultado combinado reportaría datos de otra corrida como si
  // fueran de esta — un "PASA" fantasma. Con el archivo borrado, un hijo que falla temprano
  // deja `generador`/`lecturas` en `null`, que sí se detecta más abajo.
  for (const previo of [generadorSalida, lecturasSalida]) {
    try {
      unlinkSync(previo);
    } catch {
      /* no existía — nada que borrar */
    }
  }

  const promesaGenerador = correr(
    process.execPath,
    ['generador.mjs', OBJETIVO, SYNC_S, DURACION_S, CONCURRENCIA_GENERADOR, generadorSalida],
    SALIDA.replace('.json', '.generador.log'),
  );
  const promesaLecturas = correr(
    process.execPath,
    ['lecturas.mjs', K, DURACION_S, lecturasSalida],
    SALIDA.replace('.json', '.lecturas.log'),
  );
  // En remoto no hay contenedor local que muestrear con `docker stats` — el CPU real de
  // Cloud SQL se saca aparte de Cloud Monitoring (cloudsql/metricas.sh).
  const promesaStats = ES_REMOTO
    ? Promise.resolve([])
    : muestrearDockerStats((CALENTAMIENTO + Number(DURACION_S) + 20) * 1000);

  const [rGen, rLec, stats] = await Promise.all([promesaGenerador, promesaLecturas, promesaStats]);
  writeFileSync(statsSalida, JSON.stringify(stats, null, 2));

  if (rGen.code !== 0) console.error(`generador.mjs terminó con código ${rGen.code} — ver ${generadorSalida.replace('.json', '.log')}`);
  if (rLec.code !== 0) console.error(`lecturas.mjs terminó con código ${rLec.code} — ver ${lecturasSalida.replace('.json', '.log')}`);

  let generador = null;
  let lecturas = null;
  try {
    generador = JSON.parse(readFileSync(generadorSalida, 'utf8'));
  } catch {
    /* generador no escribió resultado (falló antes) */
  }
  try {
    lecturas = JSON.parse(readFileSync(lecturasSalida, 'utf8'));
  } catch {
    /* lecturas no escribió resultado */
  }

  const cpuMuestras = stats.map((s) => Number(String(s.cpu ?? '0').replace('%', ''))).filter((n) => !Number.isNaN(n));
  const cpuPromedio = cpuMuestras.length ? cpuMuestras.reduce((a, b) => a + b, 0) / cpuMuestras.length : null;
  const cpuMax = cpuMuestras.length ? Math.max(...cpuMuestras) : null;

  // Un hijo REQUERIDO que termina con código != 0 invalida la corrida completa — no importa
  // si igual llegó a escribir un JSON parcial (p.ej. `generador.mjs` puede escribir su
  // resultado y DESPUÉS fallar en `pool.end()`) ni si el otro hijo salió limpio: K>0
  // lectores que mueren a mitad de corrida no deben poder arrastrar un "PASA sin lecturas".
  const generadorProcesoFallo = rGen.code !== 0;
  const lecturasProcesoFallo = rLec.code !== 0;
  // K>0 pide lecturas concurrentes reales — si el archivo no existe/no parsea (hijo murió
  // antes de escribir, y ya no puede ser un resultado viejo reusado porque se borró arriba)
  // o si parseó pero no completó ni una sola lectura de los 3 tipos, la corrida no tiene con
  // qué respaldar un "PASA" bajo lectura concurrente.
  const kNum = Number(K);
  const lecturasSinResultado = kNum > 0 && !lecturas;
  const lecturasSinDatos =
    kNum > 0 &&
    !!lecturas &&
    lecturas.listarHoy.n === 0 &&
    lecturas.obtenerPosiciones.n === 0 &&
    lecturas.obtenerTraza.n === 0;
  // Hallazgo 8 de revisión (2026-09-22): antes, un tipo de lectura con errores intermitentes
  // (p.ej. 30% de fallos) que igual lograba ALGÚN éxito en los otros dos tipos pasaba como
  // PASA — `lecturasSinDatos` solo detectaba el caso extremo de los 3 en cero. Ahora, con
  // K>0, CUALQUIER tipo con tasa de error > 1% O cero lecturas exitosas propias invalida la
  // corrida — cada tipo se evalúa por separado, no solo el agregado de los 3.
  const UMBRAL_TASA_ERROR_LECTURA_PCT = 1;
  const TIPOS_LECTURA = ['listarHoy', 'obtenerPosiciones', 'obtenerTraza'];
  const lecturasConErrorAlto =
    kNum > 0 && !!lecturas
      ? TIPOS_LECTURA.filter((tipo) => {
          const m = lecturas[tipo];
          return m.n === 0 || (m.tasaErrorPct ?? 0) > UMBRAL_TASA_ERROR_LECTURA_PCT;
        })
      : [];
  const lecturasErroresPorTipo =
    kNum > 0 && !!lecturas
      ? Object.fromEntries(TIPOS_LECTURA.map((tipo) => [tipo, { n: lecturas[tipo].n, errores: lecturas[tipo].errores, tasaErrorPct: lecturas[tipo].tasaErrorPct }]))
      : null;
  const generadorSinResultado = !generador;

  const invalida =
    generadorProcesoFallo ||
    lecturasProcesoFallo ||
    generadorSinResultado ||
    lecturasSinResultado ||
    lecturasSinDatos ||
    lecturasConErrorAlto.length > 0;

  const criterios = {
    throughputInsuficiente: generador ? generador.throughputVsObjetivoPct < 95 : true,
    p95LoteAlto: generador ? (generador.latenciaLoteMs.p95 ?? Infinity) > 1500 : true,
    filasPerdidas: generador ? generador.filasPerdidas > 0 : true,
    backlogNoSostenido: generador ? !generador.sostenido : true,
    corridaInvalida: generador ? !generador.corridaValida : true,
    generadorProcesoFallo,
    lecturasProcesoFallo,
    lecturasSinResultado,
    lecturasSinDatos,
    lecturasConErrorAlto: lecturasConErrorAlto.length > 0 ? lecturasConErrorAlto : false,
  };
  const falla = invalida || Object.values(criterios).some(Boolean);

  const resultado = {
    perfil: PERFIL,
    objetivoPtsSeg: Number(OBJETIVO),
    syncSegundos: Number(SYNC_S),
    concurrenciaGenerador: Number(CONCURRENCIA_GENERADOR),
    K: kNum,
    duracionMedicionS: Number(DURACION_S),
    remoto: ES_REMOTO,
    resultado: invalida ? 'INVALIDA' : falla ? 'FALLA' : 'PASA',
    criteriosFalla: criterios,
    lecturasErroresPorTipo,
    cpuPromedioPct: cpuPromedio,
    cpuMaxPct: cpuMax,
    notaCpu: ES_REMOTO ? 'remoto: CPU real en cloudsql/metricas.sh (Cloud Monitoring), no en docker stats' : null,
    generador,
    lecturas,
  };
  writeFileSync(SALIDA, JSON.stringify(resultado, null, 2));
  console.error(`<<< Punto: ${resultado.resultado} — ${JSON.stringify(criterios)}`);
  // Salida no-cero cuando la corrida queda INVALIDA — para que quien orqueste (humano o
  // `correr-matriz.mjs`, que ya tolera y loguea `status !== 0` por punto) no confunda un
  // veredicto sin datos confiables con un FALLA real del perfil medido.
  if (invalida) process.exitCode = 1;
}

main().catch((err) => {
  console.error('correr-punto falló:', err);
  process.exitCode = 1;
});
