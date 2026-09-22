/**
 * Leitura e escrita de cookies.
 *
 * O formato de ida e o de volta não são o mesmo: o navegador manda tudo em um
 * cabeçalho `Cookie` só, separado por ponto e vírgula, e o servidor responde
 * com um `Set-Cookie` por cookie, cada um com os próprios atributos. Tratar os
 * dois como se fossem simétricos é a origem de metade dos bugs de sessão.
 */

/** Interpreta o cabeçalho `Cookie`. */
export function analisar(cabecalho) {
  const cookies = Object.create(null);

  if (typeof cabecalho !== 'string' || cabecalho === '') {
    return cookies;
  }

  for (const parte of cabecalho.split(';')) {
    const igual = parte.indexOf('=');

    if (igual < 0) {
      continue;
    }

    const nome = parte.slice(0, igual).trim();
    const valor = parte.slice(igual + 1).trim();

    if (nome === '' || nome in cookies) {
      continue;
    }

    cookies[nome] = decodificar(valor);
  }

  return cookies;
}

/** Monta o valor de um `Set-Cookie`. */
export function serializar(nome, valor, opcoes = {}) {
  if (!/^[\w!#$%&'*+.^`|~-]+$/.test(nome)) {
    throw new TypeError(`Nome de cookie inválido: ${JSON.stringify(nome)}.`);
  }

  const partes = [`${nome}=${encodeURIComponent(valor)}`];

  if (opcoes.maxAge !== undefined) {
    if (!Number.isInteger(opcoes.maxAge)) {
      throw new TypeError('maxAge precisa ser um inteiro, em segundos.');
    }
    partes.push(`Max-Age=${opcoes.maxAge}`);
  }

  if (opcoes.expira instanceof Date) {
    partes.push(`Expires=${opcoes.expira.toUTCString()}`);
  }

  partes.push(`Path=${opcoes.caminho ?? '/'}`);

  if (opcoes.dominio) partes.push(`Domain=${opcoes.dominio}`);
  if (opcoes.seguro) partes.push('Secure');
  if (opcoes.soHttp !== false) partes.push('HttpOnly');

  const mesmoSite = opcoes.mesmoSite ?? 'Lax';
  if (mesmoSite) partes.push(`SameSite=${mesmoSite}`);

  return partes.join('; ');
}

/**
 * O valor de um `Set-Cookie` que apaga o cookie.
 *
 * Apagar cookie é escrever um vazio com `Max-Age=0`: não existe cabeçalho de
 * remoção. E os atributos de caminho e domínio precisam bater com os da
 * criação, senão o navegador cria um segundo cookie em vez de apagar o
 * primeiro.
 */
export function apagar(nome, opcoes = {}) {
  return serializar(nome, '', { ...opcoes, maxAge: 0 });
}

function decodificar(valor) {
  const limpo = valor.startsWith('"') && valor.endsWith('"') ? valor.slice(1, -1) : valor;

  try {
    return decodeURIComponent(limpo);
  } catch {
    // Cookie com escape malformado não deve derrubar a requisição inteira.
    return limpo;
  }
}

/** Middleware que põe os cookies em `requisicao.cookies`. */
export function cookies() {
  return (requisicao, resposta, proximo) => {
    requisicao.cookies = analisar(requisicao.headers?.cookie);
    return proximo();
  };
}
