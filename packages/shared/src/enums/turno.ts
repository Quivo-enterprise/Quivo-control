import { z } from 'zod';

// El doc técnico (§4.2) deja `horario` como texto libre en `asignaciones` sin fijar una
// taxonomía — estos 3 turnos son una asunción razonable (coincide con el demo-data previo
// de apps/web), no una decisión de Producto confirmada. Ajustar si Producto define otra cosa
// (ej. franjas horarias exactas en vez de turnos con nombre).
export const TurnoSchema = z.enum(['manana', 'tarde', 'noche']);
export type Turno = z.infer<typeof TurnoSchema>;
