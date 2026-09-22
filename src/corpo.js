/**
 * Leitura e interpretação do corpo da requisição.
 *
 * O limite de tamanho não é enfeite: sem ele, uma requisição com
 * `Content-Length` mentindo — ou sem `Content-Length` nenhum — enche a memória
 * do processo. O corte é feito enquanto os pedaços chegam, e não depois de
 * juntar tudo.
 */

/** O corpo não pôde ser lido ou interpretado. */
export class ErroDeCorpo extends Error {
  constructor(mensagem, status = 400) {
    super(mensagem);
    this.name = 'ErroDeCorpo';
    this.status = status;
  }
}

/** Limite padrão: um mebibyte. */
export const LIMITE_PADRAO = 1024 * 1024;

/** Lê o corpo cru, cortando no limite. */
export async function lerBytes(requisicao, limite = LIMITE_PADRAO) {
  const pedacos = [];
  let total = 0;

  for await (const pedaco of requisicao) {
    total += pedaco.length;

    if (total > limite) {
      throw new ErroDeCorpo(`O corpo passou do limite de ${limite} bytes.`, 413);
    }

    pedacos.push(pedaco);
  }

  return Buffer.concat(pedacos);
}

/** Lê o corpo como texto. */
export async function lerTexto(requisicao, limite = LIMITE_PADRAO) {
  return (await lerBytes(requisicao, limite)).toString('utf8');
}

/** Lê o corpo como JSON. */
export async function lerJson(requisicao, limite = LIMITE_PADRAO) {
  const texto = await lerTexto(requisicao, limite);

  if (texto.trim() === '') {
    return null;
  }

  try {
    return JSON.parse(texto);
  } catch (erro) {
    throw new ErroDeCorpo(`JSON inválido: ${erro.message}`);
  }
}

/** Lê o corpo como formulário `application/x-www-form-urlencoded`. */
export async function lerFormulario(requisicao, limite = LIMITE_PADRAO) {
  const texto = await lerTexto(requisicao, limite);
  const campos = Object.create(null);

  for (const [chave, valor] of new URLSearchParams(texto)) {
    // Campo repetido vira lista: é como um formulário com caixas de seleção
    // chega, e descartar o repetido silenciosamente perderia dado.
    if (chave in campos) {
      campos[chave] = [].concat(campos[chave], valor);
    } else {
      campos[chave] = valor;
    }
  }

  return campos;
}

/** O tipo declarado no `Content-Type`, sem os parâmetros. */
export function tipoDe(requisicao) {
  const cabecalho = requisicao.headers?.['content-type'] ?? '';
  return cabecalho.split(';')[0].trim().toLowerCase();
}

/**
 * Lê o corpo escolhendo o formato pelo `Content-Type`.
 *
 * Tipo desconhecido volta como texto em vez de erro: um cliente que manda
 * `text/csv` não está fazendo nada errado, só não é algo que este servidor
 * saiba interpretar sozinho.
 */
export async function ler(requisicao, limite = LIMITE_PADRAO) {
  const tipo = tipoDe(requisicao);

  if (tipo === 'application/json') {
    return lerJson(requisicao, limite);
  }

  if (tipo === 'application/x-www-form-urlencoded') {
    return lerFormulario(requisicao, limite);
  }

  if (tipo.startsWith('text/')) {
    return lerTexto(requisicao, limite);
  }

  return lerBytes(requisicao, limite);
}

/** Middleware que põe o corpo já interpretado em `requisicao.corpo`. */
export function corpo({ limite = LIMITE_PADRAO } = {}) {
  return async (requisicao, resposta, proximo) => {
    if (['GET', 'HEAD', 'DELETE', 'OPTIONS'].includes(requisicao.method)) {
      requisicao.corpo = null;
      return proximo();
    }

    requisicao.corpo = await ler(requisicao, limite);
    return proximo();
  };
}
