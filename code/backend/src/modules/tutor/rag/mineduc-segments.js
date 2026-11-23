// Las Bases Curriculares por asignatura (un PDF por asignatura) traen, una detrás de otra, las bases de varios
// niveles: primero 1° a 6° básico, luego 7° básico a 2° medio y al final 3° y 4° medio. Cada página (o una de cada dos)
// lleva en su encabezado "Bases Curriculares … 1º a 6º Básico" y similares. Para que un curso reciba solo las bases de
// SU nivel, el PDF se separa en tramos por nivel y cada tramo se indexa como un documento propio
// ("MINEDUC · Matemática · 7° básico a 2° medio").

/** Niveles que traen los PDF, en el orden en que aparecen. `label` es lo que se escribe en el nombre del documento. */
export const LEVELS = [
  { key: '1-6B', label: '1° a 6° básico', re: /bases curriculares (?:\w{1,2} )?1 a 6 basico/ },
  { key: '7B-2M', label: '7° básico a 2° medio', re: /bases curriculares (?:2015 )?(?:\w{1,2} )?7 basico a 2 medio/ },
  { key: '3-4M', label: '3° y 4° medio', re: /bases curriculares (?:\w{1,2} )?3 y 4 medio/ },
];

/** minúsculas, sin tildes, sin º/° y sin signos: "Bases Curriculares Ú 1º a 6º Básico" → "bases curriculares u 1 a 6 basico" */
const clean = (text) => (text ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .replace(/[º°ª]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ');

/** Índice (en LEVELS) del encabezado de nivel que aparece en la página, o -1. Si hay varios, el que aparece primero. */
export function pageLevel(pageText) {
  const t = clean(pageText);
  let best = -1;
  let bestAt = Infinity;
  LEVELS.forEach(({ re }, i) => {
    const at = t.search(re);
    if (at >= 0 && at < bestAt) { best = i; bestAt = at; }
  });
  return best;
}

/**
 * Separa las páginas de un PDF en tramos por nivel.
 * Los encabezados solo aparecen en parte de las páginas, así que cada página hereda el nivel del último encabezado visto;
 * los niveles solo avanzan (una mención suelta de un nivel anterior dentro de otro tramo se ignora), y las páginas
 * anteriores al primer encabezado (la portada) pasan al primer nivel que aparece. Sin ningún encabezado: un solo tramo sin nivel.
 *
 * @param {string[]} pages
 * @returns {{level: string | null, pages: string[], offset: number}[]}  `offset` = páginas que había antes del tramo
 */
export function segmentPagesByLevel(pages) {
  let current = -1;
  const assigned = pages.map((p) => {
    const found = pageLevel(p);
    if (found > current) current = found;
    return current;
  });
  const first = assigned.find((a) => a >= 0);
  if (first === undefined) return [{ level: null, pages, offset: 0 }];

  const segments = [];
  assigned.forEach((a, i) => {
    const level = LEVELS[a >= 0 ? a : first].label;
    const last = segments.at(-1);
    if (last && last.level === level) last.pages.push(pages[i]);
    else segments.push({ level, pages: [pages[i]], offset: i });
  });
  return segments;
}
