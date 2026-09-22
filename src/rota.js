/**
 * O padrão de uma rota, compilado.
 *
 * Um caminho como `/pedidos/:id/itens/:item` vira uma lista de segmentos, e
 * casar vira percorrer essa lista em vez de montar expressão regular. Sai mais
 * rápido e, principalmente, evita o problema clássico de transformar entrada
 * de usuário em regex.
 */

const PARAMETRO = ':';
const CURINGA = '*';

/** Um segmento do caminho, já classificado. */
class Segmento {
  constructor(bruto) {
    this.bruto = bruto;

    if (bruto === CURINGA) {
      this.tipo = 'curinga';
      this.nome = 'resto';
    } else if (bruto.startsWith(PARAMETRO)) {
      this.tipo = 'parametro';
      this.nome = bruto.slice(1);

      if (!this.nome) {
        throw new ErroDeRota(`Parâmetro sem nome em "${bruto}".`);
      }
    } else {
      this.tipo = 'literal';
      this.nome = bruto;
    }
  }
}

/** O padrão da rota não pôde ser lido. */
export class ErroDeRota extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroDeRota';
  }
}

/** Quebra um caminho em segmentos, ignorando barras repetidas e a final. */
export function segmentos(caminho) {
  return String(caminho ?? '')
    .split('/')
    .filter((parte) => parte.length > 0);
}

/** Um padrão de rota compilado. */
export class Rota {
  constructor(padrao) {
    if (typeof padrao !== 'string' || !padrao.startsWith('/')) {
      throw new ErroDeRota(`O padrão precisa começar com "/": recebi ${JSON.stringify(padrao)}.`);
    }

    this.padrao = padrao;
    this.segmentos = segmentos(padrao).map((parte) => new Segmento(parte));

    const curinga = this.segmentos.findIndex((segmento) => segmento.tipo === 'curinga');

    if (curinga >= 0 && curinga !== this.segmentos.length - 1) {
      throw new ErroDeRota('O curinga só pode aparecer no fim do padrão.');
    }

    this.temCuringa = curinga >= 0;
  }

  /**
   * Tenta casar um caminho e devolve os parâmetros, ou `null`.
   *
   * Devolver `null` em vez de lançar é de propósito: não casar é o caso comum
   * quando o roteador percorre as rotas, não uma situação excepcional.
   */
  casar(caminho) {
    const partes = segmentos(caminho);

    if (!this.temCuringa && partes.length !== this.segmentos.length) {
      return null;
    }

    if (this.temCuringa && partes.length < this.segmentos.length - 1) {
      return null;
    }

    const parametros = Object.create(null);

    for (let i = 0; i < this.segmentos.length; i += 1) {
      const segmento = this.segmentos[i];

      if (segmento.tipo === 'curinga') {
        parametros[segmento.nome] = partes.slice(i).join('/');
        return parametros;
      }

      const parte = partes[i];

      if (segmento.tipo === 'literal') {
        if (segmento.nome !== parte) {
          return null;
        }
        continue;
      }

      parametros[segmento.nome] = decodeURIComponent(parte);
    }

    return parametros;
  }

  /**
   * Quão específica a rota é. O roteador ordena por isso para que
   * `/pedidos/novo` ganhe de `/pedidos/:id`, independente da ordem em que
   * foram registradas — que é o erro mais comum em roteador caseiro.
   */
  get especificidade() {
    let pontos = 0;

    for (const segmento of this.segmentos) {
      if (segmento.tipo === 'literal') pontos += 3;
      else if (segmento.tipo === 'parametro') pontos += 2;
    }

    return pontos;
  }

  /** Os nomes dos parâmetros do padrão. */
  get parametros() {
    return this.segmentos
      .filter((segmento) => segmento.tipo !== 'literal')
      .map((segmento) => segmento.nome);
  }

  toString() {
    return this.padrao;
  }
}
