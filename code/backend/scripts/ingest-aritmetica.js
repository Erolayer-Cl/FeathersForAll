import { createOllamaEmbedder } from '../src/modules/tutor/embeddings-client.js';
import { createPgVectorStore } from '../src/modules/tutor/rag/pg-vector-store.js';
import { createRagService } from '../src/modules/tutor/rag/rag-service.js';
import { createDb } from '../src/platform/db.js';

async function main() {
  const db = createDb({ connectionString: process.env.DATABASE_ADMIN_URL });
  const embedder = createOllamaEmbedder({
    endpoint: process.env.LLM_ENDPOINT || 'http://127.0.0.1:11434',
    model: process.env.EMBEDDING_MODEL || 'bge-m3',
  });
  const store = createPgVectorStore({ db });
  const rag = createRagService({ embedder, store });

  const text = `# Operaciones Básicas y Aritmética

## Suma o Adición
La suma o adición es la operación matemática que consiste en reunir o añadir varias cantidades en una sola. Los elementos que se suman se llaman sumandos y el resultado se llama suma o total.
El signo de la suma es "+".
Ejemplos fundamentales:
- 1 + 1 = 2 (uno más uno es igual a dos).
- 2 + 2 = 4.
- 5 + 3 = 8.
- 10 + 15 = 25.

Propiedades de la suma:
- Conmutativa: El orden de los sumandos no altera la suma (a + b = b + a). Por ejemplo: 2 + 3 = 3 + 2 = 5.
- Asociativa: La forma de agrupar los sumandos no cambia el resultado: (a + b) + c = a + (b + c).
- Elemento neutro: El cero es el elemento neutro de la suma: a + 0 = a. Por ejemplo: 7 + 0 = 7.

## Resta o Sustracción
La resta o sustracción consiste en quitar una cantidad (sustraendo) de otra (minuendo) para hallar la diferencia.
El signo de la resta es "-".
Ejemplos:
- 5 - 3 = 2.
- 10 - 4 = 6.
- 1 - 1 = 0.

## Multiplicación y Tablas
La multiplicación es una suma abreviada de sumandos iguales. Los números que se multiplican se llaman factores y el resultado es el producto.
El signo de la multiplicación puede ser "×", "*" o "·".
Ejemplos:
- 3 × 4 = 12 (tres veces cuatro es doce).
- 10 × 10 = 100.
- 6 × 8 = 48.

## División
La división consiste en repartir una cantidad en partes iguales. Sus términos son el dividendo, el divisor, el cociente y el resto.
El signo de la división es "÷" o "/".
Ejemplos:
- 12 ÷ 3 = 4.
- 100 ÷ 4 = 25.
- 90 ÷ 3 = 30.

## Resolución de Problemas y Proporciones
Para resolver un problema numérico o de proporcionalidad directa (regla de tres):
1. Se identifica el valor unitario (dividiendo el valor total entre la cantidad de elementos).
2. Se multiplica el valor unitario por la nueva cantidad deseada.
Por ejemplo: Si 4 cuadernos cuestan 120 pesos, el valor unitario por cuaderno es 120 ÷ 4 = 30 pesos. Para 8 cuadernos, se calcula 8 × 30 = 240 pesos (o bien, como 8 es el doble de 4, el costo es 120 × 2 = 240 pesos).
`;

  const tenantId = process.env.DEFAULT_TENANT_ID || '11111111-1111-1111-1111-111111111111';
  const courseId = process.env.DEFAULT_COURSE_ID || 'c0000000-0000-0000-0000-000000000001';
  const actor = { id: 'a0000000-0000-0000-0000-000000000001', rol: 'docente' };

  console.log('Ingestando operaciones_basicas_y_aritmetica.md en Matemática 7°A...');
  const res = await rag.ingest({
    tenantId,
    courseId,
    docId: 'operaciones_basicas_y_aritmetica.md',
    text,
    title: 'Operaciones Básicas y Aritmética',
    actor,
  });
  console.log('Ingestado con éxito:', res);
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
