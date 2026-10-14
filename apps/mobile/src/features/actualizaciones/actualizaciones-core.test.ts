import { afterEach, describe, expect, it } from 'vitest';
import {
  INTERVALO_CHEQUEO_MS,
  debeChequear,
  debeLeerEstadoNativo,
  debeReintentarTrasPublicacion,
  lecturaDesdeEstadoNativo,
  puedeOperarOtaAhora,
  esPantallaPreOperacion,
  estaInactivoAhora,
  estadoBotonActualizar,
  etiquetaVersion,
  puedeAplicarAhora,
  recorridoInactivo,
} from './actualizaciones-core';
import {
  marcarRecorridoActivoGlobal,
  reiniciarEstadoRecorridoActivoParaTests,
} from '../operacion/estado-recorrido-activo';

describe('etiquetaVersion', () => {
  it('muestra "integrada" con el bundle embebido', () => {
    expect(etiquetaVersion('0.2.0', '00000000-0000-0000-0000-000000000000', true)).toBe('0.2.0 · integrada');
  });
  it('muestra 8 caracteres del updateId con OTA', () => {
    expect(etiquetaVersion('0.2.0', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', false)).toBe('0.2.0 · a1b2c3d4');
  });
  it('cae a "integrada" si no hay updateId y tolera versión vacía', () => {
    expect(etiquetaVersion(null, null, false)).toBe('— · integrada');
  });
});

describe('estadoBotonActualizar', () => {
  it('en desarrollo: "No disponible en desarrollo"', () => {
    expect(estadoBotonActualizar({ isDev: true, updatesHabilitado: false })).toEqual({
      habilitado: false,
      motivo: 'No disponible en desarrollo',
    });
  });
  it('release con updates desactivados: mensaje distinto', () => {
    expect(estadoBotonActualizar({ isDev: false, updatesHabilitado: false })).toEqual({
      habilitado: false,
      motivo: 'Actualizaciones desactivadas en esta versión',
    });
  });
  it('habilitado en release con updates', () => {
    expect(estadoBotonActualizar({ isDev: false, updatesHabilitado: true })).toEqual({ habilitado: true });
  });
});

describe('recorridoInactivo', () => {
  it('sin lectura real se trata como ACTIVO', () => {
    expect(recorridoInactivo({ hayActivo: false, huboLectura: false })).toBe(false);
  });
  it('lectura real sin recorrido: inactivo', () => {
    expect(recorridoInactivo({ hayActivo: false, huboLectura: true })).toBe(true);
  });
  it('lectura real con recorrido: activo', () => {
    expect(recorridoInactivo({ hayActivo: true, huboLectura: true })).toBe(false);
  });
});

describe('estaInactivoAhora (estado compartido en vivo)', () => {
  afterEach(() => reiniciarEstadoRecorridoActivoParaTests());
  it('false antes de cualquier lectura', () => {
    expect(estaInactivoAhora()).toBe(false);
  });
  it('sigue el estado publicado, sin capturarlo', () => {
    marcarRecorridoActivoGlobal(false);
    expect(estaInactivoAhora()).toBe(true);
    marcarRecorridoActivoGlobal(true);
    expect(estaInactivoAhora()).toBe(false);
  });
});

describe('debeChequear', () => {
  const base = {
    actualizacionesDisponibles: true,
    inactivo: true,
    enCurso: false,
    ahora: 10_000_000,
    ultimoChequeo: null as number | null,
  };
  it('primer chequeo: sí', () => {
    expect(debeChequear(base)).toBe(true);
  });
  it('no con recorrido activo / sin lectura', () => {
    expect(debeChequear({ ...base, inactivo: false })).toBe(false);
  });
  it('no si ya hay uno en curso o las actualizaciones no están disponibles', () => {
    expect(debeChequear({ ...base, enCurso: true })).toBe(false);
    expect(debeChequear({ ...base, actualizacionesDisponibles: false })).toBe(false);
  });
  it('throttle de 30 min', () => {
    expect(debeChequear({ ...base, ultimoChequeo: base.ahora - (INTERVALO_CHEQUEO_MS - 1) })).toBe(false);
    expect(debeChequear({ ...base, ultimoChequeo: base.ahora - INTERVALO_CHEQUEO_MS })).toBe(true);
  });
  it('reloj retrocedido no bloquea', () => {
    expect(debeChequear({ ...base, ultimoChequeo: base.ahora + 5000 })).toBe(true);
  });
});

describe('puedeAplicarAhora / esPantallaPreOperacion', () => {
  it('requiere inactivo Y pantalla pre-operación libre', () => {
    expect(puedeAplicarAhora({ inactivo: true, pantallaPreOperacionLibre: true })).toBe(true);
    expect(puedeAplicarAhora({ inactivo: false, pantallaPreOperacionLibre: true })).toBe(false);
    expect(puedeAplicarAhora({ inactivo: true, pantallaPreOperacionLibre: false })).toBe(false);
  });
  it('pantallas pre-operación', () => {
    expect(esPantallaPreOperacion('vehiculo', false)).toBe(true);
    expect(esPantallaPreOperacion('asignacion', false)).toBe(true);
    expect(esPantallaPreOperacion('asignacion', true)).toBe(false);
    expect(esPantallaPreOperacion('operacion', false)).toBe(false);
    expect(esPantallaPreOperacion('restaurando', false)).toBe(false);
  });
});

describe('lecturaDesdeEstadoNativo', () => {
  it('enabled true -> activo; false -> inactivo; ilegible -> null', () => {
    expect(lecturaDesdeEstadoNativo({ enabled: true })).toBe(true);
    expect(lecturaDesdeEstadoNativo({ enabled: false })).toBe(false);
    expect(lecturaDesdeEstadoNativo({})).toBeNull();
    expect(lecturaDesdeEstadoNativo({ enabled: 'yes' })).toBeNull();
    expect(lecturaDesdeEstadoNativo(null)).toBeNull();
    expect(lecturaDesdeEstadoNativo(undefined)).toBeNull();
  });
});

describe('debeLeerEstadoNativo', () => {
  it('solo sin lectura previa', () => {
    expect(debeLeerEstadoNativo(false)).toBe(true);
    expect(debeLeerEstadoNativo(true)).toBe(false);
  });
});

describe('debeReintentarTrasPublicacion', () => {
  it('reintenta solo con inactivo y app en primer plano', () => {
    expect(debeReintentarTrasPublicacion(false, 'active')).toBe(true);
    expect(debeReintentarTrasPublicacion(false, 'background')).toBe(false);
    expect(debeReintentarTrasPublicacion(true, 'active')).toBe(false);
  });
});

describe('puedeOperarOtaAhora', () => {
  it('exige inactivo y app activa', () => {
    expect(puedeOperarOtaAhora({ inactivo: true, appState: 'active' })).toBe(true);
    expect(puedeOperarOtaAhora({ inactivo: true, appState: 'background' })).toBe(false);
    expect(puedeOperarOtaAhora({ inactivo: false, appState: 'active' })).toBe(false);
  });
});
