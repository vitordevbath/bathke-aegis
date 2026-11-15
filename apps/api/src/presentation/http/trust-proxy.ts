/**
 * Fastify `trustProxy`: the API is reachable only through Nginx, exactly one
 * hop. Trusting only that hop makes `request.ip` the address Nginx appended to
 * X-Forwarded-For (`$proxy_add_x_forwarded_for`), so entries a client wrote in
 * that header are ignored. Rate limits are keyed by this address.
 */
export const trustOnlyNginx = (_address: string, hop: number): boolean => hop === 0;
