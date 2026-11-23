// Ordem da fila quando a categoria tem subcategorias.
//
// Sem isso, um lote cadastrado de uma vez entra em bloco (5 panelas seguidas, depois 5 vestidos)
// e o grupo recebe tudo do mesmo tipo em sequência. Aqui as subcategorias saem em rodízio
// (panelas, roupas, íntimas, maquiagem, unhas, panelas, roupas...), pulando a que já acabou
// os itens e mantendo a ordem de chegada dentro de cada subcategoria.
//
// São funções puras: entra uma lista, sai a mesma lista em outra ordem. Quem grava a posição
// (queueOrder) é o src/offers.js.

// items: as ofertas na ordem atual da fila.
// subOf(item): a subcategoria do item ('' conta como uma subcategoria à parte).
// order: ordem do rodízio (os ids das subcategorias da categoria, na ordem configurada).
// keepFirst: quantos itens do começo ficam onde estão (1 = não mexe na próxima a postar).
export function interleave(items, subOf, { order = [], keepFirst = 0 } = {}) {
  const list = [...items];
  const fixed = list.slice(0, Math.min(Math.max(0, keepFirst), list.length));
  const rest = list.slice(fixed.length);

  const groups = new Map();
  for (const item of rest) {
    const key = String(subOf(item) ?? '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  // Primeiro as subcategorias na ordem configurada; depois qualquer outra que aparecer na fila.
  const keys = [...new Set([...order.map(String), ...groups.keys()])].filter((key) => groups.has(key));

  // Se o último item que ficou parado (keepFirst) é da mesma subcategoria que ia começar o
  // rodízio, essa subcategoria vai pro fim da rodada: senão o rodízio começa repetindo.
  const lastFixed = fixed.length ? String(subOf(fixed[fixed.length - 1]) ?? '') : '';
  if (keys.length > 1 && keys[0] === lastFixed) keys.push(keys.shift());
  const rounds = Math.max(0, ...[...groups.values()].map((g) => g.length));

  const out = [];
  for (let round = 0; round < rounds; round++) {
    for (const key of keys) {
      const item = groups.get(key)[round];
      if (item !== undefined) out.push(item);
    }
  }
  return [...fixed, ...out];
}

// A lista já está intercalada? (serve pra não gravar nem avisar a tela sem precisar)
export function sameOrder(a, b) {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}
