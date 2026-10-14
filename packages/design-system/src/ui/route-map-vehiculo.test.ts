import { describe, expect, it } from 'vitest';
import { firmaPunto } from './route-map-puntos.js';
import {
  PERIODO_PARPADEO_MS,
  alertaVisible,
  etiquetaAlerta,
  fotoUsable,
  marcarFotoFallida,
  normalizarFotoUrl,
  zIndexVehiculo,
} from './route-map-vehiculo.js';

const ctx = { oscuro: false, tipo: 'marker' as const, rol: 'marker' };
const base = { pinType: 'vehicle' as const, label: 'ABC123', estadoFrescura: 'reportando', placa: 'ABC123' };

describe('etiquetaAlerta', () => {
  it('singular y plural, con la severidad', () => {
    expect(etiquetaAlerta({ nivel: 'gravisima', abiertas: 2, parpadea: true })).toBe('2 infracciones abiertas, gravísima');
    expect(etiquetaAlerta({ nivel: 'grave', abiertas: 1, parpadea: false })).toBe('1 infracción abierta, grave');
    expect(etiquetaAlerta({ nivel: 'leve', abiertas: 3, parpadea: true })).toBe('3 infracciones abiertas, leve');
  });
  it('sin alerta o sin abiertas no dice nada', () => {
    expect(etiquetaAlerta(undefined)).toBe('');
    expect(etiquetaAlerta({ nivel: 'grave', abiertas: 0, parpadea: false })).toBe('');
    expect(alertaVisible({ nivel: 'grave', abiertas: 0, parpadea: false })).toBe(false);
  });
});

describe('zIndexVehiculo', () => {
  it('seleccionado > gravísima > grave > leve > resto', () => {
    const z = (p: Parameters<typeof zIndexVehiculo>[0]) => zIndexVehiculo(p);
    const sel = z({ seleccionado: true, alerta: { nivel: 'leve', abiertas: 1, parpadea: true } });
    const gravisima = z({ alerta: { nivel: 'gravisima', abiertas: 1, parpadea: true } });
    const grave = z({ alerta: { nivel: 'grave', abiertas: 1, parpadea: true } });
    const leve = z({ alerta: { nivel: 'leve', abiertas: 1, parpadea: false } });
    const resto = z({});
    expect(sel).toBeGreaterThan(gravisima);
    expect(gravisima).toBeGreaterThan(grave);
    expect(grave).toBeGreaterThan(leve);
    expect(leve).toBeGreaterThan(resto);
  });
  it('una alerta sin abiertas no sube el apilado', () => {
    expect(zIndexVehiculo({ alerta: { nivel: 'gravisima', abiertas: 0, parpadea: false } })).toBe(zIndexVehiculo({}));
  });
});

describe('PERIODO_PARPADEO_MS', () => {
  it('cada nivel parpadea por debajo de 3 Hz y más rápido cuanto más grave', () => {
    expect(PERIODO_PARPADEO_MS).toEqual({ leve: 1600, grave: 1000, gravisima: 600 });
    for (const ms of Object.values(PERIODO_PARPADEO_MS)) expect(1000 / ms).toBeLessThan(3);
  });
});

describe('fotoUsable', () => {
  it('vacía no, fallida no, resto sí', () => {
    expect(fotoUsable(undefined)).toBe(false);
    expect(fotoUsable('  ')).toBe(false);
    expect(fotoUsable('https://x.test/a.jpg')).toBe(true);
    marcarFotoFallida('https://x.test/rota.jpg');
    expect(fotoUsable('https://x.test/rota.jpg')).toBe(false);
  });
});

describe('firmaPunto con foto, alerta y selección', () => {
  const sig = (extra: object) => firmaPunto({ ...base, ...extra }, ctx);
  it('cambia con foto, color de línea, nivel y parpadeo', () => {
    const f0 = sig({});
    expect(sig({ fotoUrl: 'https://x.test/a.jpg' })).not.toBe(f0);
    expect(sig({ colorLinea: '#ff0000' })).not.toBe(f0);
    const alerta = { nivel: 'grave' as const, abiertas: 1, parpadea: true };
    const fa = sig({ alerta });
    expect(fa).not.toBe(f0);
    expect(sig({ alerta: { ...alerta, nivel: 'gravisima' as const } })).not.toBe(fa);
    expect(sig({ alerta: { ...alerta, parpadea: false } })).not.toBe(fa);
    expect(sig({ estadoFrescura: 'detenido' })).not.toBe(f0);
  });
  it('NO cambia con la selección ni con la cantidad de abiertas (se actualizan en el elemento)', () => {
    const f0 = sig({});
    const alerta = { nivel: 'grave' as const, abiertas: 1, parpadea: true };
    expect(sig({ seleccionado: true })).toBe(f0);
    expect(sig({ alerta: { ...alerta, abiertas: 2 } })).toBe(sig({ alerta }));
    expect(sig({ alerta: { ...alerta, abiertas: 7 }, seleccionado: true })).toBe(sig({ alerta }));
  });
  it('es estable si nada visible cambia (no recrea el contenido en cada poll)', () => {
    const alerta = { nivel: 'grave' as const, abiertas: 1, parpadea: true };
    const onClick = () => undefined;
    expect(sig({ alerta, fotoUrl: 'u', onClick })).toBe(sig({ alerta: { ...alerta }, fotoUrl: 'u', onClick: () => undefined }));
  });
});

describe('normalizarFotoUrl', () => {
  it('recorta los bordes y trata vacío como sin foto', () => {
    expect(normalizarFotoUrl('  https://x.test/a.jpg \n')).toBe('https://x.test/a.jpg');
    expect(normalizarFotoUrl('   ')).toBeNull();
    expect(normalizarFotoUrl(undefined)).toBeNull();
  });
  it('una foto que falló con espacios queda marcada también sin ellos (misma clave normalizada)', () => {
    marcarFotoFallida(' https://x.test/rota.jpg ');
    expect(fotoUsable('https://x.test/rota.jpg')).toBe(false);
    expect(fotoUsable('  https://x.test/rota.jpg')).toBe(false);
    expect(fotoUsable('https://x.test/ok.jpg')).toBe(true);
  });
});

describe('alerta con infracciones atendidas (pendiente E #1)', () => {
  it('sin abiertas pero con atendidas la alerta sigue visible, fija y con texto propio', () => {
    const solo = { nivel: 'grave' as const, abiertas: 0, atendidas: 2, parpadea: false };
    expect(alertaVisible(solo)).toBe(true);
    expect(etiquetaAlerta(solo)).toBe('2 infracciones atendidas, grave');
    expect(etiquetaAlerta({ ...solo, atendidas: 1 })).toBe('1 infracción atendida, grave');
  });
  it('con abiertas el texto sigue hablando de las abiertas', () => {
    expect(etiquetaAlerta({ nivel: 'leve', abiertas: 1, atendidas: 3, parpadea: true })).toBe('1 infracción abierta, leve');
  });
  it('sin abiertas ni atendidas no hay alerta', () => {
    expect(alertaVisible({ nivel: 'grave', abiertas: 0, atendidas: 0, parpadea: false })).toBe(false);
  });
  it('el badge "M" entra en la firma del contenido', () => {
    const ctx = { oscuro: false, tipo: 'marker' as const, rol: 'marker' };
    const base = { pinType: 'vehicle' as const, color: '#000', label: 'x' };
    expect(firmaPunto({ ...base, molinos: true }, ctx)).not.toBe(firmaPunto(base, ctx));
  });
});
