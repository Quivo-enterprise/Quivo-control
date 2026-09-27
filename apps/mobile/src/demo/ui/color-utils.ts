/**
 * Helper compartido por los componentes de `src/demo/ui/` — decide si un color de anillo/relleno
 * es lo bastante claro como para necesitar un hairline extra por fuera para seguir siendo visible
 * sobre fondos claros/blur (caso real: Línea 120, `#ffffff` — un anillo blanco puro se "pierde"
 * contra las glass cards del top overlay sin un borde adicional). Fórmula de luminancia relativa
 * simplificada (coeficientes ITU-R BT.601), suficiente para decidir un umbral binario, no para
 * cálculos de accesibilidad WCAG completos.
 */
export function esColorClaro(hexColor: string): boolean {
  const hex = hexColor.replace('#', '');
  if (hex.length !== 6) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return false;
  const luminancia = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminancia > 0.7;
}
