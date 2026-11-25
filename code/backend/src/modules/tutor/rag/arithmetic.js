// Calculadora exacta para preguntas como "1+1", "cuánto es 10x10" o "3/4 + 1/2".
//
// Por qué existe: un modelo chico (3B) se equivoca al calcular y, sin apuntes, el tutor ni siquiera
// intentaba responder. Aquí el resultado lo calcula el CÓDIGO (determinista y exacto) y el LLM solo lo
// explica con palabras. Nada de `eval`: es un analizador propio que solo entiende números y operaciones.
//
// Soporta + − × ÷ (también x, *, /, :), potencias (^), paréntesis, decimales con coma (2,5) y
// fracciones exactas (3/4 + 1/2 = 5/4). Si la frase trae cualquier otra palabra, NO es un cálculo
// (devuelve null) y el turno sigue su camino normal.

const MAX_DIGITS = 40; // resultados gigantes no se calculan
const MAX_EXPONENT = 64n;

class TooBig extends Error {}
class DivisionByZero extends Error {}

// ---------------------------------------------------------------- fracciones exactas (BigInt)

const abs = (a) => (a < 0n ? -a : a);
const gcd = (a, b) => {
  let x = abs(a);
  let y = abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1n;
};

function frac(n, d = 1n) {
  if (d === 0n) throw new DivisionByZero();
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d);
  const out = { n: n / g, d: d / g };
  if (out.n.toString().length > MAX_DIGITS || out.d.toString().length > MAX_DIGITS) throw new TooBig();
  return out;
}

const add = (a, b) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a, b) => frac(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a, b) => frac(a.n * b.n, a.d * b.d);
const div = (a, b) => frac(a.n * b.d, a.d * b.n);

function pow(base, exp) {
  if (exp.d !== 1n) throw new TooBig(); // solo exponentes enteros
  const e = exp.n;
  if (abs(e) > MAX_EXPONENT) throw new TooBig();
  let result = frac(1n);
  for (let i = 0n; i < abs(e); i++) result = mul(result, base);
  return e < 0n ? div(frac(1n), result) : result;
}

// ---------------------------------------------------------------- texto -> fichas

// Palabras que acompañan un cálculo sin ser parte de él: "cuánto es", "calcula", "el resultado de"…
const WRAPPERS = [
  /\b(cuanto|cuantos|cuanta|cuantas)\s+(es|da|son|seria|resulta|vale|sale|dan)\b/g,
  /\b(me\s+puedes\s+decir|puedes\s+decirme|dime|calcula|calcular|calculame|resuelve|resolver|el\s+resultado\s+de|resultado\s+de|cual\s+es|cuanto|por\s+favor|porfa|pluma)\b/g,
];

// Operaciones dichas con palabras.
const WORD_OPERATORS = [
  [/\bdividido\s+(por|entre)\b/g, ' / '],
  [/\belevado\s+a\s+la\b/g, ' ^ '],
  [/\belevado\s+a\b/g, ' ^ '],
  [/\bal\s+cuadrado\b/g, ' ^ 2 '],
  [/\bal\s+cubo\b/g, ' ^ 3 '],
  [/\bmas\b/g, ' + '],
  [/\bmenos\b/g, ' - '],
  [/\bpor\b/g, ' * '],
  [/\bentre\b/g, ' / '],
];

/** minúsculas y sin tildes (conserva × ÷ − que no son letras con tilde). */
const plain = (s) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

function toNumber(text) {
  // 1.000 = mil (punto de miles chileno); 2,5 y 2.5 = dos y medio.
  let t = text;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d+([.,]\d+)?$/.test(t)) t = t.replace(',', '.');
  else return null;
  const [int, dec = ''] = t.split('.');
  return frac(BigInt(int + dec), 10n ** BigInt(dec.length));
}

/** @returns {{type: 'num'|'op', value: any, raw?: string}[] | null} */
function tokenize(expression) {
  const tokens = [];
  const s = expression.replace(/\s+/g, '');
  for (let i = 0; i < s.length;) {
    const ch = s[i];
    if (/\d/.test(ch)) {
      const m = /^\d[\d.,]*\d|^\d/.exec(s.slice(i));
      const value = toNumber(m[0]);
      if (!value) return null;
      tokens.push({ type: 'num', value, raw: m[0] });
      i += m[0].length;
    } else if ('+-*/^()'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
    } else return null;
  }
  return tokens;
}

// ---------------------------------------------------------------- analizador (precedencia normal)

function evaluate(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v) => peek()?.type === 'op' && peek().value === v;
  const fail = () => { throw new SyntaxError('expresión inválida'); };

  function atom() {
    const t = peek();
    if (!t) fail();
    if (t.type === 'num') { pos++; return t.value; }
    if (isOp('(')) {
      pos++;
      const v = expr();
      if (!isOp(')')) fail();
      pos++;
      return v;
    }
    return fail();
  }
  function power() {
    const base = atom();
    if (isOp('^')) { pos++; return pow(base, unary()); }
    return base;
  }
  function unary() {
    if (isOp('-')) { pos++; return mul(frac(-1n), unary()); }
    if (isOp('+')) { pos++; return unary(); }
    return power();
  }
  function term() {
    let v = unary();
    while (isOp('*') || isOp('/')) {
      const op = peek().value;
      pos++;
      const r = unary();
      v = op === '*' ? mul(v, r) : div(v, r);
    }
    return v;
  }
  function expr() {
    let v = term();
    while (isOp('+') || isOp('-')) {
      const op = peek().value;
      pos++;
      const r = term();
      v = op === '+' ? add(v, r) : sub(v, r);
    }
    return v;
  }

  const result = expr();
  if (pos !== tokens.length) fail();
  return result;
}

// ---------------------------------------------------------------- formato (es-CL)

const intText = (n) => new Intl.NumberFormat('es-CL', { useGrouping: false }).format(n);

/** Decimal con coma. Exacto si la fracción termina (denominador solo 2 y 5); si no, redondeado a 4 decimales. */
function decimalText(f) {
  let d = f.d;
  while (d % 2n === 0n) d /= 2n;
  while (d % 5n === 0n) d /= 5n;
  const exact = d === 1n;
  const digits = exact ? 12 : 4;
  const scale = 10n ** BigInt(digits);
  const negative = f.n < 0n;
  const scaled = (abs(f.n) * scale * 2n + f.d) / (f.d * 2n); // redondeo al más cercano
  const int = scaled / scale;
  let dec = (scaled % scale).toString().padStart(digits, '0');
  if (exact) dec = dec.replace(/0+$/, '');
  else dec = dec.replace(/0+$/, '') || '0';
  const body = dec ? `${intText(int)},${dec}` : intText(int);
  return `${exact ? '' : '≈ '}${negative ? '−' : ''}${body}`;
}

function describe(f) {
  if (f.d === 1n) return { result: (f.n < 0n ? '−' : '') + intText(abs(f.n)) };
  const sign = f.n < 0n ? '−' : '';
  const result = `${sign}${intText(abs(f.n))}/${intText(f.d)}`;
  const out = { result, decimal: decimalText(f) };
  if (abs(f.n) > f.d) out.mixed = `${sign}${intText(abs(f.n) / f.d)} ${intText(abs(f.n) % f.d)}/${intText(f.d)}`;
  return out;
}

// ---------------------------------------------------------------- API

/**
 * Si el mensaje es solo un cálculo, lo resuelve. Si no lo es, devuelve null.
 * @param {string} query
 * @returns {null | {ok: true, expression: string, result: string, decimal?: string, mixed?: string, text: string}
 *   | {ok: false, reason: 'division-por-cero', expression: string, text: string}}
 */
export function solveArithmetic(query) {
  if (typeof query !== 'string' || query.length > 200) return null;
  let t = plain(query).replace(/[¿?¡!=]/g, ' ');
  for (const re of WRAPPERS) t = t.replace(re, ' ');
  for (const [re, symbol] of WORD_OPERATORS) t = t.replace(re, symbol);
  t = t
    .replace(/(?<=\d)\s*x\s*(?=\d)/g, '*') // "10x10"; una x suelta NO es una multiplicación
    .replace(/[×·]/g, '*')
    .replace(/[÷:]/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/\.\s*$/, '')
    .trim();
  if (!/^[\d\s.,+\-*/^()]+$/.test(t) || !/\d/.test(t) || !/[+\-*/^]/.test(t.replace(/^\s*[-+]/, ''))) return null;

  const tokens = tokenize(t);
  if (!tokens) return null;
  const expression = tokens
    .map((k) => (k.type === 'num' ? k.raw : k.value === '*' ? ' × ' : '+-'.includes(k.value) ? ` ${k.value === '-' ? '−' : '+'} ` : k.value))
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')')
    .replace(/(^|\() ?([−+]) /g, '$1$2') // signo de un número (−3), no una resta
    .replace(/([×]) ([−]) /g, '$1 $2')
    .trim();

  try {
    const value = evaluate(tokens);
    const d = describe(value);
    const extras = [d.mixed, d.decimal].filter(Boolean);
    const text = `${expression} = ${d.result}${extras.length ? ` (${extras.join(' = ')})` : ''}`;
    return { ok: true, expression, ...d, text };
  } catch (err) {
    if (err instanceof DivisionByZero) {
      return { ok: false, reason: 'division-por-cero', expression, text: `${expression}: no se puede dividir por cero, esa operación no tiene resultado` };
    }
    return null; // resultado enorme o expresión mal formada: que siga el camino normal
  }
}
