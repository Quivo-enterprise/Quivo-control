import { describe, expect, it } from 'vitest';
import {
  clickTrasArrastre,
  debeCerrarArrastre,
  descripcionPunto,
  etiquetaPunto,
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

describe('etiquetaPunto / descripcionPunto', () => {
  const base = { label: ' Nodo 2 ', description: 'Arrastra para desplazar' };
  it('no arrastrable: etiqueta y descripción, sin ayuda de teclado', () => {
    expect(etiquetaPunto(base, 'marker')).toBe('Nodo 2, Arrastra para desplazar');
    expect(descripcionPunto(base, 'marker')).toBe('');
  });
  it('arrastrable: nombre corto con Alt+Enter y la descripción aparte', () => {
    const p = { ...base, draggable: true, onDragEnd: noop };
    expect(etiquetaPunto(p, 'marker')).toBe('Nodo 2 — Alt+Enter para mover');
    expect(descripcionPunto(p, 'marker')).toBe('Arrastra para desplazar');
    expect(etiquetaPunto(p, 'marker')).not.toContain('Alt+Espacio');
  });
  it('sin etiqueta usa la descripción como nombre y no la repite', () => {
    const p = { description: 'Punto marcado', draggable: true, onDragEnd: noop };
    expect(etiquetaPunto(p, 'marker')).toBe('Punto marcado — Alt+Enter para mover');
    expect(descripcionPunto(p, 'marker')).toBe('');
  });
  it('una parada nunca es arrastrable', () => {
    expect(etiquetaPunto({ ...base, draggable: true, onDragEnd: noop }, 'stop')).toBe('Nodo 2, Arrastra para desplazar');
  });
});

const VENTANA = 500;

describe('clickTrasArrastre', () => {
  it('suprime un click dentro de la ventana y consume el estado', () => {
    expect(clickTrasArrastre(1000, 1100)).toEqual({ suprimir: true, finArrastreTs: null });
  });
  it('un click fuera de la ventana pasa (y también consume)', () => {
    expect(clickTrasArrastre(1000, 1000 + VENTANA + 1)).toEqual({ suprimir: false, finArrastreTs: null });
  });
  it('sin arrastre pendiente nunca suprime', () => {
    expect(clickTrasArrastre(null, 5)).toEqual({ suprimir: false, finArrastreTs: null });
  });
  it('un click anterior al fin del arrastre no es el que lo cierra', () => {
    expect(clickTrasArrastre(1000, 900).suprimir).toBe(false);
  });
  it('solo un click: tras consumir, el siguiente (aunque sea inmediato) pasa', () => {
    const primero = clickTrasArrastre(1000, 1010);
    expect(clickTrasArrastre(primero.finArrastreTs, 1020).suprimir).toBe(false);
  });
});

describe('debeCerrarArrastre', () => {
  it('sin arrastre en curso nunca cierra nada', () => {
    expect(debeCerrarArrastre({ tipo: 'pointerdown' }, { arrastrando: false, modo: 'teclado' })).toBe(false);
  });
  it('un pointerdown cierra cualquier arrastre', () => {
    expect(debeCerrarArrastre({ tipo: 'pointerdown' }, { arrastrando: true, modo: 'teclado' })).toBe(true);
    expect(debeCerrarArrastre({ tipo: 'pointerdown' }, { arrastrando: true, modo: 'puntero' })).toBe(true);
  });
  it('por teclado: las flechas y Enter son el arrastre, Esc lo cancela, perder el foco lo corta', () => {
    const estado = { arrastrando: true, modo: 'teclado' as const };
    expect(debeCerrarArrastre({ tipo: 'keydown', tecla: 'ArrowRight' }, estado)).toBe(false);
    expect(debeCerrarArrastre({ tipo: 'keydown', tecla: 'Enter' }, estado)).toBe(false);
    expect(debeCerrarArrastre({ tipo: 'keydown', tecla: 'Escape' }, estado)).toBe(true);
    expect(debeCerrarArrastre({ tipo: 'focusout' }, estado)).toBe(true);
  });
  it('con puntero: una tecla lo interrumpe y el foco no cuenta', () => {
    const estado = { arrastrando: true, modo: 'puntero' as const };
    expect(debeCerrarArrastre({ tipo: 'keydown', tecla: 'a' }, estado)).toBe(true);
    expect(debeCerrarArrastre({ tipo: 'focusout' }, estado)).toBe(false);
  });
});
