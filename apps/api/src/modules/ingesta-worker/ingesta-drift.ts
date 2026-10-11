// RF-58..66 (doc técnico §12 riesgo de drift de reloj de dispositivo): sin una cifra fija
// del doc técnico, 5 minutos es una asunción razonable de este equipo — más que el drift
// típico de un reloj de teléfono sin sincronizar, lo bastante chico para detectar un caso
// real (dispositivo con la hora mal puesta a mano, etc.).
// Vive en su propio archivo para que el worker (que lo usa para alertar y para no mover
// `recorridoEstado` con un `ts` futuro) y los reportes (que aplican la misma elegibilidad al
// leer `eventos_operativos`) compartan UNA sola cifra sin que `reportes` importe BullMQ.
export const DRIFT_ALERTA_MS = 5 * 60 * 1000;
