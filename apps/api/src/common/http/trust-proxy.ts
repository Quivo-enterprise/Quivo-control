/**
 * Saltos de proxy de confianza delante de la app: 1 = solo el front end de Google de Cloud Run
 * (sin LB externo). Con N saltos, `req.ip` es la dirección N posiciones desde el socket, o sea
 * la que GFE vio; las entradas anteriores de `X-Forwarded-For` (falsificables) se ignoran.
 * Si se agrega un LB/CDN delante de Cloud Run, subir a 2.
 */
export const TRUST_PROXY_HOPS = 1;
