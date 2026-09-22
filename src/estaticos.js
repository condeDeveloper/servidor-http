/**
 * Servir arquivo do disco.
 *
 * A parte que importa aqui não é ler o arquivo: é garantir que o caminho
 * pedido não escape da pasta. `GET /../../etc/passwd` é o ataque mais antigo
 * que existe em servidor web, e a defesa é resolver o caminho absoluto e
 * conferir que ele continua dentro da raiz — nunca procurar por ".." no texto,
 * que escapa com codificação.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

/** Tipos por extensão, para o `Content-Type`. */
export const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};

/** O tipo de um caminho pela extensão. */
export function tipoDe(caminho) {
  return TIPOS[extname(caminho).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Resolve o caminho pedido dentro da raiz, ou devolve `null` se ele escapar.
 */
export function resolverDentro(raiz, pedido) {
  const base = resolve(raiz);

  let decodificado;
  try {
    decodificado = decodeURIComponent(pedido);
  } catch {
    return null;
  }

  // O normalize resolve os ".." de verdade; comparar o resultado com a raiz é
  // o que fecha a porta, inclusive para "..%2f" e afins.
  const alvo = resolve(join(base, normalize(decodificado)));

  if (alvo !== base && !alvo.startsWith(base + sep)) {
    return null;
  }

  return alvo;
}

/** Middleware que serve arquivos de uma pasta. */
export function estaticos(raiz, { indice = 'index.html', cache = 0 } = {}) {
  const base = resolve(raiz);

  return async (requisicao, resposta, proximo) => {
    if (requisicao.method !== 'GET' && requisicao.method !== 'HEAD') {
      return proximo();
    }

    const caminho = new URL(requisicao.url, 'http://local').pathname;
    const alvo = resolverDentro(base, caminho);

    if (alvo === null) {
      return resposta.problema(403, 'Caminho fora da pasta servida.');
    }

    const arquivo = await encontrar(alvo, indice);

    if (arquivo === null) {
      return proximo();
    }

    resposta.setHeader('Content-Type', tipoDe(arquivo.caminho));
    resposta.setHeader('Content-Length', arquivo.tamanho);
    resposta.setHeader('Cache-Control', cache > 0 ? `public, max-age=${cache}` : 'no-cache');

    if (requisicao.method === 'HEAD') {
      return resposta.end();
    }

    return new Promise((cumprir, rejeitar) => {
      const fluxo = createReadStream(arquivo.caminho);
      fluxo.on('error', rejeitar);
      fluxo.on('end', cumprir);
      fluxo.pipe(resposta);
    });
  };
}

async function encontrar(alvo, indice) {
  try {
    const informacao = await stat(alvo);

    if (informacao.isFile()) {
      return { caminho: alvo, tamanho: informacao.size };
    }

    if (informacao.isDirectory() && indice) {
      const doIndice = join(alvo, indice);
      const dados = await stat(doIndice);

      if (dados.isFile()) {
        return { caminho: doIndice, tamanho: dados.size };
      }
    }

    return null;
  } catch {
    return null;
  }
}
