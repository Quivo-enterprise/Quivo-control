-- `cerradaPorSistema`: la sesión la cerró `RotacionesService.cerrarSesionesVencidas` (inactividad o
-- asignación vencida), no el chofer con logout. /en-vivo la muestra "Inactivo" en vez de "Finalizado".
ALTER TABLE sesiones_operativas ADD COLUMN "cerradaPorSistema" boolean NOT NULL DEFAULT false;
