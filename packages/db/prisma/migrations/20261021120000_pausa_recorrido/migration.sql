-- docs/plan-pausa-recorrido.md — pausar/reanudar el recorrido (almuerzo) sin terminarlo.
-- Solo AMPLÍA el dominio del CHECK de `recorridoEstado` con `en_pausa` (compatible hacia atrás: r23
-- sigue funcionando). `eventos_operativos.tipo` es TEXT sin CHECK (verificado), no hay nada que ampliar.
ALTER TABLE sesiones_operativas DROP CONSTRAINT sesiones_operativas_recorrido_estado_check;
ALTER TABLE sesiones_operativas
  ADD CONSTRAINT sesiones_operativas_recorrido_estado_check
    CHECK ("recorridoEstado" IS NULL OR "recorridoEstado" IN ('en_curso', 'en_pausa', 'finalizado'));
