/**
 * Datos de ejemplo en memoria — solo para que el demo del panel administrativo (QUI-227)
 * tenga contenido navegable en cada módulo. Los CRUD reales llegan con QUI-220 en
 * adelante (M1), contra `packages/db` (Prisma, QUI-217) y la API real. Nada de esto se
 * persiste ni pega contra `apps/api`.
 */
import type { StatusBadgeStatus } from '@quivo/design-system';

export interface SindicatoDemo extends Record<string, unknown> {
  id: string;
  nombre: string;
  ciudad: string;
  socios: number;
  vehiculos: number;
  estado: StatusBadgeStatus;
}

export const SINDICATOS: SindicatoDemo[] = [
  { id: 's-1', nombre: 'Sindicato 1º de Mayo', ciudad: 'Cochabamba', socios: 184, vehiculos: 172, estado: 'active' },
  { id: 's-2', nombre: 'Sindicato Unificado del Norte', ciudad: 'La Paz', socios: 231, vehiculos: 219, estado: 'active' },
];

export interface SocioDemo extends Record<string, unknown> {
  id: string;
  nombre: string;
  documento: string;
  sindicato: string;
  fechaAlta: string;
  estado: StatusBadgeStatus;
}

export const SOCIOS: SocioDemo[] = [
  { id: 'so-1', nombre: 'Ramiro Quispe Mamani', documento: '4521873 CB', sindicato: 'Sindicato 1º de Mayo', fechaAlta: '2021-03-14', estado: 'active' },
  { id: 'so-2', nombre: 'Elena Fernández Rojas', documento: '7845210 LP', sindicato: 'Sindicato Unificado del Norte', fechaAlta: '2019-08-02', estado: 'active' },
  { id: 'so-3', nombre: 'Julio César Mendoza', documento: '3312098 CB', sindicato: 'Sindicato 1º de Mayo', fechaAlta: '2022-11-20', estado: 'idle' },
  { id: 'so-4', nombre: 'Patricia Villca Choque', documento: '6098741 LP', sindicato: 'Sindicato Unificado del Norte', fechaAlta: '2023-01-09', estado: 'active' },
  { id: 'so-5', nombre: 'Álvaro Terrazas Guzmán', documento: '2287654 CB', sindicato: 'Sindicato 1º de Mayo', fechaAlta: '2018-06-30', estado: 'inactive' },
];

export interface VehiculoDemo extends Record<string, unknown> {
  id: string;
  patente: string;
  marcaModelo: string;
  sindicato: string;
  conductor: string | null;
  estado: StatusBadgeStatus;
}

export const VEHICULOS: VehiculoDemo[] = [
  { id: 'v-1', patente: '1234-ABC', marcaModelo: 'Mercedes-Benz OF-1721', sindicato: 'Sindicato 1º de Mayo', conductor: 'Ramiro Quispe Mamani', estado: 'active' },
  { id: 'v-2', patente: '5678-XYZ', marcaModelo: 'Volkswagen 17.230', sindicato: 'Sindicato Unificado del Norte', conductor: 'Elena Fernández Rojas', estado: 'active' },
  { id: 'v-3', patente: '9012-DEF', marcaModelo: 'Hino FC9J', sindicato: 'Sindicato 1º de Mayo', conductor: null, estado: 'idle' },
  { id: 'v-4', patente: '3456-GHI', marcaModelo: 'Mercedes-Benz OF-1721', sindicato: 'Sindicato Unificado del Norte', conductor: null, estado: 'warning' },
];

export interface ConductorDemo extends Record<string, unknown> {
  id: string;
  nombre: string;
  licencia: string;
  licenciaVence: string;
  sindicato: string;
  estado: StatusBadgeStatus;
}

export const CONDUCTORES: ConductorDemo[] = [
  { id: 'c-1', nombre: 'Ramiro Quispe Mamani', licencia: 'Cat. P (profesional)', licenciaVence: '2027-04-10', sindicato: 'Sindicato 1º de Mayo', estado: 'active' },
  { id: 'c-2', nombre: 'Elena Fernández Rojas', licencia: 'Cat. P (profesional)', licenciaVence: '2026-09-22', sindicato: 'Sindicato Unificado del Norte', estado: 'active' },
  { id: 'c-3', nombre: 'Julio César Mendoza', licencia: 'Cat. P (profesional)', licenciaVence: '2026-08-01', sindicato: 'Sindicato 1º de Mayo', estado: 'warning' },
];

export interface LineaDemo extends Record<string, unknown> {
  id: string;
  codigo: string;
  nombre: string;
  sindicato: string;
  paradas: number;
  estado: StatusBadgeStatus;
}

export const LINEAS: LineaDemo[] = [
  { id: 'l-1', codigo: 'L-101', nombre: 'Terminal — Zona Norte', sindicato: 'Sindicato 1º de Mayo', paradas: 24, estado: 'active' },
  { id: 'l-2', codigo: 'L-204', nombre: 'Circunvalación Sur', sindicato: 'Sindicato Unificado del Norte', paradas: 31, estado: 'active' },
  { id: 'l-3', codigo: 'L-315', nombre: 'Plaza Central — Villa Este', sindicato: 'Sindicato 1º de Mayo', paradas: 18, estado: 'pending' },
];

export interface RotacionDemo extends Record<string, unknown> {
  id: string;
  conductor: string;
  vehiculo: string;
  linea: string;
  turno: 'Mañana' | 'Tarde' | 'Noche';
  fecha: string;
  estado: StatusBadgeStatus;
}

export const ROTACIONES: RotacionDemo[] = [
  { id: 'rot-1', conductor: 'Ramiro Quispe Mamani', vehiculo: '1234-ABC', linea: 'L-101', turno: 'Mañana', fecha: '2026-07-24', estado: 'active' },
  { id: 'rot-2', conductor: 'Elena Fernández Rojas', vehiculo: '5678-XYZ', linea: 'L-204', turno: 'Tarde', fecha: '2026-07-24', estado: 'pending' },
  { id: 'rot-3', conductor: 'Julio César Mendoza', vehiculo: '9012-DEF', linea: 'L-101', turno: 'Noche', fecha: '2026-07-24', estado: 'pending' },
];

export interface ReglaDemo extends Record<string, unknown> {
  id: string;
  codigo: string;
  descripcion: string;
  severidad: 'Leve' | 'Grave' | 'Muy grave';
  aplicaA: string;
}

export const REGLAS: ReglaDemo[] = [
  { id: 'reg-1', codigo: 'RS-01', descripcion: 'Llegada tarde a punto de control (>10 min)', severidad: 'Leve', aplicaA: 'Conductores' },
  { id: 'reg-2', codigo: 'RS-04', descripcion: 'Desvío de ruta no autorizado', severidad: 'Grave', aplicaA: 'Conductores' },
  { id: 'reg-3', codigo: 'RS-09', descripcion: 'Vehículo circulando sin control técnico vigente', severidad: 'Muy grave', aplicaA: 'Vehículos' },
];

export interface AuditoriaDemo extends Record<string, unknown> {
  id: string;
  action: string;
  user: string;
  timestamp: string;
  details?: string;
}

export const AUDITORIA: AuditoriaDemo[] = [
  { id: 'a-1', action: 'Inicio de sesión', user: 'admin@quivo.local', timestamp: '2026-07-23 08:12', details: 'IP 190.104.22.10' },
  { id: 'a-2', action: 'Alta de socio', user: 'admin@quivo.local', timestamp: '2026-07-23 09:41', details: 'Patricia Villca Choque' },
  { id: 'a-3', action: 'Publicación de rotación', user: 'admin@quivo.local', timestamp: '2026-07-22 18:03', details: 'Turno 2026-07-24' },
];
