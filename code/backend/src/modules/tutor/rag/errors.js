/** El curso no existe o no pertenece al colegio indicado (nunca se distingue: evita filtrar la existencia de cursos ajenos). */
export class CourseNotFoundError extends Error {
  constructor() {
    super('El curso no existe en este colegio');
    this.name = 'CourseNotFoundError';
  }
}

/** El usuario no tiene permiso para esa acción (p. ej. un estudiante que intenta subir apuntes). */
export class RagForbiddenError extends Error {
  constructor(message = 'Solo el docente del curso o el admin del colegio pueden gestionar los apuntes') {
    super(message);
    this.name = 'RagForbiddenError';
  }
}

/** El modelo de embeddings no calza con la columna vector(N) de la base. */
export class EmbeddingDimensionError extends Error {
  constructor(got, expected) {
    super(`El modelo de embeddings genera vectores de ${got} dimensiones y la base espera ${expected}. `
      + 'Usa bge-m3 (EMBEDDING_MODEL) o cambia vector(N) en 02_s06_ajustes.sql y vuelve a indexar.');
    this.name = 'EmbeddingDimensionError';
  }
}
