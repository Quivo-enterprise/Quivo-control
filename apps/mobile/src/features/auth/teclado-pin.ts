/** Añade un único dígito sin superar el máximo del contrato del PIN. */
export function agregarDigito(pin: string, digito: string): string {
  return /^\d$/.test(digito) && pin.length < 12 ? pin + digito : pin;
}

export function borrarDigito(pin: string): string {
  return pin.slice(0, -1);
}

export function puedeEnviar(pin: string): boolean {
  return /^\d{6,12}$/.test(pin);
}

export function cantidadPuntos(pin: string): number {
  return Math.max(6, Math.min(12, pin.length));
}
