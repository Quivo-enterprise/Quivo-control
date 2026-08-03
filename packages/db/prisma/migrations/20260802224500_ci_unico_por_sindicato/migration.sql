-- Un mismo CI no puede representar dos socios o dos conductores dentro del mismo
-- sindicato. Se mantienen índices separados porque una persona sí puede ser socio y
-- conductor a la vez.
CREATE UNIQUE INDEX "socios_sindicatoId_documentoIdentidad_key"
ON "socios"("sindicatoId", "documentoIdentidad");

CREATE UNIQUE INDEX "conductores_sindicatoId_documentoIdentidad_key"
ON "conductores"("sindicatoId", "documentoIdentidad");
