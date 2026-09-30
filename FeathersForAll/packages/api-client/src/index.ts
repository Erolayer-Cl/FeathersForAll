// Cliente tipado de la API de AulaViva.
// NO editar schema.d.ts a mano: se regenera con `npm run generate` desde api/openapi.yaml.
import createClient from "openapi-fetch";
import type { paths, components } from "./schema";

export type Schemas = components["schemas"];
export type Course = Schemas["Course"];
export type Assessment = Schemas["Assessment"];
export type SubmissionResult = Schemas["SubmissionResult"];
export type TutorQuestion = Schemas["TutorQuestion"];
export type Problem = Schemas["Problem"];

export interface ClientOptions {
  /** Ej: "http://localhost:3000/v1" o el mock de Prism "http://127.0.0.1:4010" (sin /v1). */
  baseUrl: string;
  /** Devuelve el JWT vigente (incluye tenant_id y rol). */
  getToken: () => string | Promise<string>;
}

export function createAulaVivaClient({ baseUrl, getToken }: ClientOptions) {
  const client = createClient<paths>({ baseUrl });
  client.use({
    async onRequest({ request }) {
      request.headers.set("Authorization", `Bearer ${await getToken()}`);
      // Idempotency-Key automática en POST si el llamador no la definió.
      if (request.method === "POST" && !request.headers.has("Idempotency-Key")) {
        request.headers.set("Idempotency-Key", crypto.randomUUID());
      }
      return request;
    },
  });
  return client;
}

// Ejemplo de uso (H4):
//   const api = createAulaVivaClient({ baseUrl: "http://127.0.0.1:4010", getToken: () => token });
//   const { data, error } = await api.POST("/assessments/{assessmentId}/submissions", {
//     params: { path: { assessmentId } , header: { "Idempotency-Key": crypto.randomUUID() } },
//     body: { answers: [{ question_id, selected_option: 1 }] },
//   });
