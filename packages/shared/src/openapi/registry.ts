import { OpenAPIRegistry, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Side effect: agrega el método `.openapi()` a todos los schemas Zod. Debe correr
// antes de generar el documento (ver generate.ts) — el resto del paquete no depende de esto.
extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();
