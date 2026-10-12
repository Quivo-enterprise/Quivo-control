import { describe, expect, it } from 'vitest';
import {
  etiquetaPunto,
  siguienteSupresionClick,
  decidirActualizacionPunto,
  esArrastrable,
  esInteractivo,
  firmaPunto,
  latLngDePosicion,
} from './route-map-puntos.js';

const ctx = { oscuro: false, tipo: 'marker' as const, rol: 'marker' };
const noop = () => undefined;

describe('esArrastrable / esInteractivo', () => {
  it('exige draggable Y onDragEnd', () => {
    expect(esArrastrable({ draggable: true, onDragEnd: noop })).toBe(true);
    expect(esArrastrable({ draggable: true })).toBe(false);
    expect(esArrastrable({ onDragEnd: noop })).toBe(false);
    expect(esArrastrable({ draggable: false, onDragEnd: noop })).toBe(false);
  });
  it('clickable o arrastrable es interactivo', () => {
    expect(esInteractivo({})).toBe(false);
    expect(esInteractivo({ onClick: noop })).toBe(true);
    expect(esInteractivo({ draggable: true, onDragEnd: noop })).toBe(true);
  });
});

describe('esArrastrable en paradas', () => {
  it('las paradas nunca son arrastrables (como en MapLibre)', () => {
    expect(esArrastrable({ draggable: true, onDragEnd: noop }, 'stop')).toBe(false);
    expect(esInteractivo({ draggable: true, onDragEnd: noop }, 'stop')).toBe(false);
  });
});

describe('firmaPunto', () => {
  const base = { pinType: 'pulse' as const, color: '#ff6b35', label: 'Punto', description: 'Arrastra' };
  it('no cambia con la identidad de los callbacks (no reinicia el pulso)', () => {
    const a = firmaPunto({ ...base, draggable: true, onDragEnd: () => undefined }, ctx);
    const b = firmaPunto({ ...base, draggable: true, onDragEnd: () => undefined }, ctx);
    expect(a).toBe(b);
    const c = firmaPunto({ ...base, onClick: () => undefined, draggable: true, onDragEnd: noop }, ctx);
    const d = firmaPunto({ ...base, onClick: () => undefined, draggable: true, onDragEnd: noop }, ctx);
    expect(c).toBe(d);
  });
  it('cambia si cambia lo visible o la interactividad', () => {
    const a = firmaPunto(base, ctx);
    expect(firmaPunto({ ...base, pinType: 'node' }, ctx)).not.toBe(a);
    expect(firmaPunto({ ...base, color: '#000' }, ctx)).not.toBe(a);
    expect(firmaPunto({ ...base, label: 'Otro' }, ctx)).not.toBe(a);
    expect(firmaPunto({ ...base, onClick: noop }, ctx)).not.toBe(a);
    expect(firmaPunto({ ...base, draggable: true, onDragEnd: noop }, ctx)).not.toBe(a);
    expect(firmaPunto(base, { ...ctx, oscuro: true })).not.toBe(a);
  });
});

describe('decidirActualizacionPunto', () => {
  const ultima = { lat: -17.39, lng: -66.15 };
  it('durante el arrastre no toca contenido ni posición', () => {
    expect(
      decidirActualizacionPunto({
        arrastrando: true,
        firmaPrevia: 'a',
        firmaNueva: 'b',
        ultima,
        posicion: { lat: 1, lng: 2 },
      }),
    ).toEqual({ recrearContenido: false, moverPosicion: false, sincronizarArrastre: false });
  });
  it('sin arrastre: mueve la posición sin recrear el contenido si la firma es igual', () => {
    expect(
      decidirActualizacionPunto({
        arrastrando: false,
        firmaPrevia: 'a',
        firmaNueva: 'a',
        ultima,
        posicion: { lat: -17.4, lng: -66.15 },
      }),
    ).toEqual({ recrearContenido: false, moverPosicion: true, sincronizarArrastre: true });
  });
  it('sin cambios no hace nada; con firma distinta recrea', () => {
    const igual = { arrastrando: false, firmaPrevia: 'a', firmaNueva: 'a', ultima, posicion: { ...ultima } };
    expect(decidirActualizacionPunto(igual)).toEqual({ recrearContenido: false, moverPosicion: false, sincronizarArrastre: true });
    expect(decidirActualizacionPunto({ ...igual, firmaNueva: 'b' }).recrearContenido).toBe(true);
  });
});

describe('latLngDePosicion', () => {
  it('lee literales y objetos LatLng con métodos', () => {
    expect(latLngDePosicion({ lat: 1, lng: 2 })).toEqual({ lat: 1, lng: 2 });
    expect(latLngDePosicion({ lat: () => 3, lng: () => 4 })).toEqual({ lat: 3, lng: 4 });
  });
  it('null, undefined o no finito => null', () => {
    expect(latLngDePosicion(null)).toBeNull();
    expect(latLngDePosicion(undefined)).toBeNull();
    expect(latLngDePosicion({ lat: NaN, lng: 1 })).toBeNull();
  });
});

describe('vehículos', () => {
  it('nunca son arrastrables', () => {
    expect(esArrastrable({ draggable: true, onDragEnd: noop, pinType: 'vehicle' })).toBe(false);
    expect(esInteractivo({ draggable: true, onDragEnd: noop, pinType: 'vehicle' })).toBe(false);
  });
});

describe('etiquetaPunto', () => {
  it('suma la ayuda de teclado solo si es arrastrable', () => {
    const base = { label: ' Nodo 2 ', description: 'Arrastra' };
    expect(etiquetaPunto(base, 'marker')).toBe('Nodo 2, Arrastra');
    expect(etiquetaPunto({ ...base, draggable: true, onDragEnd: noop }, 'marker')).toContain('Alt+Espacio');
    expect(etiquetaPunto({ ...base, draggable: true, onDragEnd: noop }, 'stop')).toBe('Nodo 2, Arrastra');
  });
});

describe('siguienteSupresionClick', () => {
  it('solo terminar un arrastre arma la supresión; cualquier entrada nueva la apaga', () => {
    expect(siguienteSupresionClick('arrastre')).toBe(true);
    expect(siguienteSupresionClick('pointerdown')).toBe(false);
    expect(siguienteSupresionClick('keydown')).toBe(false);
  });
});
