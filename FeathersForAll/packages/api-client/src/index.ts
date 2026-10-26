// Cliente tipado de la API de FeathersForAll.
// NO editar schema.d.ts a mano: se regenera con `npm run generate` desde api/openapi.yaml.
import createClient from "openapi-fetch";
import type { paths, components } from "./schema";

export type Schemas = components["schemas"];
export type Course = Schemas["Course"];
export type Assessment = Schemas["Assessment"];
export type SubmissionResult = Schemas["SubmissionResult"];
export type TutorQuestion = Schemas["TutorQuestion"];
export type Problem = Schemas["Problem"];
// v1.1.0 — identidad y notas del estudiante (ADR 0007)
export type LoginInput = Schemas["LoginInput"];
export type Session = Schemas["Session"];
export type Me = Schemas["Me"];
export type MyGrades = Schemas["MyGrades"];
export type MyCourseGrades = Schemas["MyCourseGrades"];
export type GradeEntry = Schemas["GradeEntry"];
export type GradeDetail = Schemas["GradeDetail"];
// v1.2.0 — conversaciones guardadas del tutor (ADR 0008). El envío de mensajes responde en
// streaming (text/plain): para leerlo por fragmentos, usar fetch directo (ver chatApi.js del frontend).
export type TutorConversation = Schemas["TutorConversation"];
export type TutorConversationDetail = Schemas["TutorConversationDetail"];
export type TutorMessage = Schemas["TutorMessage"];
export type TutorMessageInput = Schemas["TutorMessageInput"];
export type TutorSource = Schemas["TutorSource"];

export interface ClientOptions {
  /** Ej: "http://localhost:3000/v1" o el mock de Prism "http://127.0.0.1:4010" (sin /v1). */
  baseUrl: string;
  /** Devuelve el JWT vigente (incluye tenant_id y rol). */
  getToken: () => string | Promise<string>;
}

export function createFeathersForAllClient({ baseUrl, getToken }: ClientOptions) {
  const client = createClient<paths>({ baseUrl });
  client.use({
    async onRequest({ request }) {
      // POST /auth/login es la única operación sin token.
      if (!new URL(request.url).pathname.endsWith("/auth/login")) {
        request.headers.set("Authorization", `Bearer ${await getToken()}`);
      }
      // Idempotency-Key automática en los POST que crean recursos, si el llamador no la definió.
      if (request.method === "POST" && !request.url.endsWith("/auth/login") && !request.headers.has("Idempotency-Key")) {
        request.headers.set("Idempotency-Key", crypto.randomUUID());
      }
      return request;
    },
  });
  return client;
}

// Ejemplo de uso (H4):
//   const api = createFeathersForAllClient({ baseUrl: "http://127.0.0.1:4010", getToken: () => token });
//   const { data, error } = await api.POST("/assessments/{assessmentId}/submissions", {
//     params: { path: { assessmentId } , header: { "Idempotency-Key": crypto.randomUUID() } },
//     body: { answers: [{ question_id, selected_option: 1 }] },
//   });
