import { z } from 'zod';

// shortcut: nombres fijos de la Línea 16 (SR = PC rol terminal, Molinos = rol espera); migrar a FK a puntos_control cuando se cargue otra línea con terminales propias.
export const ParadaSalidaSchema = z.enum(['salomon_romero', 'molinos']);
export type ParadaSalida = z.infer<typeof ParadaSalidaSchema>;

export const ETIQUETA_PARADA_SALIDA: Record<ParadaSalida, string> = { salomon_romero: 'Salomón Romero', molinos: 'Molinos' };
