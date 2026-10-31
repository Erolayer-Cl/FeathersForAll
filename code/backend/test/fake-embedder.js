// Embedder de prueba: bolsa de palabras hasheada (sin Ollama). Textos con palabras en común
// quedan cerca; textos sin palabras en común quedan ortogonales (similitud 0).
// Con PostgreSQL usar fakeEmbedder(1024): la columna es vector(1024).
export function fakeEmbedder(dim = 256) {
  const calls = [];
  return {
    calls,
    async embed(texts) {
      calls.push(texts);
      return texts.map((text) => {
        const v = new Array(dim).fill(0);
        for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
          if (word.length <= 3) continue; // ignora artículos y preposiciones
          let h = 7;
          for (const c of word) h = (h * 31 + c.charCodeAt(0)) % dim;
          v[h] += 1;
        }
        return v;
      });
    },
  };
}
