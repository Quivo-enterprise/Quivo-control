# Plan de evolución — Vehículo

Documento de trabajo derivado de `QV-ESP-ESP-CTL-2026-001 v0.1`. La entidad debe describir la unidad física; línea, ruta, turno y conductor actual pertenecen a asignaciones operativas.

## Incremento implementado

- placa visible y valor normalizado para comparación global;
- tipo controlado con identificación visual;
- socio propietario del mismo sindicato;
- marca guiada con excepción de texto validado;
- modelo alfanumérico;
- color principal y secundario controlados;
- capacidad con rango técnico y advertencia orientativa por tipo;
- estado inicial `pendiente`, activación validada e historial de estados;
- filtros básicos por tipo y estado.

## Siguiente incremento recomendado

### Identificación técnica

- año de fabricación;
- número de chasis/VIN;
- número de motor;
- número interno de unidad, almacenado en la asignación o afiliación cuando dependa de la línea;
- fotografía principal con recorte y compresión.

Estos campos requieren definición de visibilidad, unicidad y tratamiento de datos heredados antes de crear la migración.

### Cumplimiento documental

- RUAT o documento de propiedad;
- revisión técnica y fecha de vencimiento;
- SOAT/seguro y fecha de vencimiento;
- adjuntos con tipo, emisor, número, vigencia y estado de verificación.

Conviene modelar documentos en una entidad relacionada y no agregar una columna por archivo. Esto permitirá alertas, renovaciones e historial sin ensanchar `Vehiculo` en cada nueva obligación.

### Mantenimiento

- kilometraje actual con fecha de lectura;
- motivo y orden de mantenimiento;
- fecha de ingreso y retorno estimado/real;
- mantenimientos preventivos por kilometraje o tiempo.

El kilometraje debe ser histórico. Guardar únicamente el último valor impediría auditar saltos o lecturas erróneas.

## Orden sugerido

1. Foto, año y chasis, por su valor inmediato para identificar la unidad.
2. Entidad documental y alertas de vencimiento.
3. Transferencia entre sindicatos con historial de afiliación.
4. Mantenimiento y kilometraje histórico.
5. Telemetría, QUIVO Pay e importación masiva.

## Decisiones pendientes

- regla oficial y longitud mínima de placas bolivianas;
- catálogo definitivo de tipos y rangos de capacidad por ciudad;
- excepción para activar sin socio propietario;
- alcance de `Ómnibus` y `Otro autorizado`;
- unicidad y formato de chasis, motor y número interno;
- política de almacenamiento, retención y acceso a fotografías/documentos.
