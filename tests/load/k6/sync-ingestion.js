import http from 'k6/http';
import { check, fail } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const sustainedBatchSize = numberEnv('SUSTAINED_BATCH_SIZE', 100);
const sustainedEventsPerSecond = numberEnv('SUSTAINED_EVENTS_PER_SECOND', 300);
const sustainedRequestRate = Math.ceil(sustainedEventsPerSecond / sustainedBatchSize);
const burstBatchSize = numberEnv('BURST_BATCH_SIZE', 500);

export const options = {
  discardResponseBodies: false,
  scenarios: {
    sustained_300_points_per_second: {
      executor: 'constant-arrival-rate',
      rate: sustainedRequestRate,
      timeUnit: '1s',
      duration: __ENV.SUSTAINED_DURATION || '5m',
      preAllocatedVUs: numberEnv('SUSTAINED_PREALLOCATED_VUS', 12),
      maxVUs: numberEnv('SUSTAINED_MAX_VUS', 60),
      exec: 'sustained',
      tags: { workload: 'sustained' },
    },
    fleet_reconnect_burst: {
      executor: 'constant-arrival-rate',
      startTime: __ENV.BURST_START_TIME || '5m10s',
      rate: numberEnv('BURST_BATCHES_PER_SECOND', 20),
      timeUnit: '1s',
      duration: __ENV.BURST_DURATION || '30s',
      preAllocatedVUs: numberEnv('BURST_PREALLOCATED_VUS', 40),
      maxVUs: numberEnv('BURST_MAX_VUS', 200),
      exec: 'burst',
      tags: { workload: 'fleet-reconnect' },
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{workload:sustained}': ['p(95)<500'],
    'http_req_duration{workload:fleet-reconnect}': ['p(95)<1500'],
    batch_rejected: ['rate<0.01'],
    enqueue_latency_ms: ['p(95)<500'],
  },
};

const eventsSent = new Counter('events_sent');
const eventsAccepted = new Counter('events_accepted');
const batchRejected = new Rate('batch_rejected');
const enqueueLatency = new Trend('enqueue_latency_ms', true);

export function setup() {
  const required = ['MOBILE_ACCESS_TOKEN', 'SESSION_ID', 'DEVICE_ID'];
  const missing = required.filter((name) => !__ENV[name]);
  if (missing.length > 0) {
    fail(`Faltan variables requeridas: ${missing.join(', ')}`);
  }
  if (sustainedBatchSize > 500 || burstBatchSize > 500) {
    fail('Los lotes de sync admiten un máximo de 500 eventos');
  }
  return {
    baseUrl: (__ENV.BASE_URL || 'http://127.0.0.1:3001').replace(/\/$/, ''),
    accessToken: __ENV.MOBILE_ACCESS_TOKEN,
    sessionId: __ENV.SESSION_ID,
    deviceId: __ENV.DEVICE_ID,
  };
}

export function sustained(config) {
  sendBatch(config, sustainedBatchSize);
}

export function burst(config) {
  sendBatch(config, burstBatchSize);
}

function sendBatch(config, batchSize) {
  const now = Date.now();
  const eventos = Array.from({ length: batchSize }, (_, index) => ({
    eventId: uuidV7(now + index),
    deviceId: config.deviceId,
    ts: new Date(now + index).toISOString(),
    tipo: 'gps_point',
    payload: {
      sesionId: config.sessionId,
      lat: -16.4897 + Math.random() * 0.002,
      lng: -68.1193 + Math.random() * 0.002,
      accuracy: 5 + Math.random() * 10,
      speed: 4 + Math.random() * 8,
    },
  }));

  const response = http.post(`${config.baseUrl}/v1/sync/batches`, JSON.stringify({ eventos }), {
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
    },
    compression: (__ENV.REQUEST_COMPRESSION || '').toLowerCase() === 'gzip' ? 'gzip' : undefined,
    tags: { name: 'POST /v1/sync/batches' },
    timeout: __ENV.REQUEST_TIMEOUT || '30s',
  });

  eventsSent.add(batchSize);
  enqueueLatency.add(response.timings.duration);

  let accepted = [];
  try {
    accepted = response.json('aceptados') || [];
  } catch (_) {
    accepted = [];
  }
  const ok = check(response, {
    'sync responde 202': (res) => res.status === 202,
    'acuse contiene todo el lote': () => accepted.length === batchSize,
  });
  batchRejected.add(!ok);
  eventsAccepted.add(accepted.length);
}

function uuidV7(timestampMs) {
  const timestamp = Math.floor(timestampMs).toString(16).padStart(12, '0').slice(-12);
  const random = randomHex(20);
  return `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-7${random.slice(0, 3)}-${variantNibble()}${random.slice(3, 6)}-${random.slice(6, 18)}`;
}

function randomHex(length) {
  let value = '';
  while (value.length < length)
    value += Math.floor(Math.random() * 0x100000000)
      .toString(16)
      .padStart(8, '0');
  return value.slice(0, length);
}

function variantNibble() {
  return (8 + Math.floor(Math.random() * 4)).toString(16);
}

function numberEnv(name, fallback) {
  const value = Number(__ENV[name] || fallback);
  if (!Number.isFinite(value) || value <= 0) fail(`${name} debe ser un número positivo`);
  return Math.floor(value);
}
