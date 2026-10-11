// La implementación vive en `@quivo/shared` (la app móvil también la necesita, release 13).
// Se re-exporta acá para no tocar los imports existentes de `apps/api`.
export {
  fechaActualBolivia,
  finDeJornadaBolivia,
  horaEnBolivia,
  inicioDeJornadaBolivia,
  inicioDeJornadaSiguienteBolivia,
} from '@quivo/shared';
