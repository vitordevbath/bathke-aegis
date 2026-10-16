/** Response body of `GET /health` on Aegis API. */
export interface HealthResponse {
  readonly status: 'ok';
  readonly service: 'aegis-api';
}
