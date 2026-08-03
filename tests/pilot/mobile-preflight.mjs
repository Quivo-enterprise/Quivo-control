const baseUrl = (process.env.BASE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const token = process.env.MOBILE_ACCESS_TOKEN;
if (!token) throw new Error('MOBILE_ACCESS_TOKEN es requerido');

const report = {
  checkedAt: new Date().toISOString(),
  baseUrl,
  checks: [],
};

await checkJson('API health', `${baseUrl}/v1/health`, {}, (body) => body.status === 'ok');
await checkJson(
  'paquete del día vigente',
  `${baseUrl}/v1/mobile/asignacion-del-dia`,
  { Authorization: `Bearer ${token}` },
  (body) =>
    Boolean(
      body.asignacion?.id &&
        body.asignacion?.venceAt &&
        body.ruta?.geometria?.type === 'LineString' &&
        body.linea?.codigo &&
        Array.isArray(body.paradas) &&
        Array.isArray(body.puntosControl),
    ),
);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.checks.some((item) => !item.ok)) process.exitCode = 1;

async function checkJson(name, url, headers, validate) {
  const startedAt = performance.now();
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    const body = await response.json();
    report.checks.push({
      name,
      ok: response.ok && validate(body),
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
      details: summarize(name, body),
    });
  } catch (error) {
    report.checks.push({
      name,
      ok: false,
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function summarize(name, body) {
  if (name === 'API health') return { status: body.status };
  return {
    asignacionId: body.asignacion?.id,
    venceAt: body.asignacion?.venceAt,
    linea: body.linea?.codigo,
    paradas: body.paradas?.length,
    puntosControl: body.puntosControl?.length,
  };
}
