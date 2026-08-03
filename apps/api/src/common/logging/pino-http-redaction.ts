/**
 * Secretos transportados en headers HTTP. `remove` evita que Pino conserve incluso una
 * representación censurada que pueda confundir una revisión posterior de los logs.
 */
export const pinoHttpRedaction = {
  paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
  remove: true,
};
