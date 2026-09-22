/**
 * O servidor: junta roteador, middleware e tratamento de erro.
 *
 * A cadeia de middleware é uma função que chama a próxima. O detalhe que faz
 * ela funcionar é o índice não poder andar para trás: sem essa trava, um
 * middleware que chama `proximo()` duas vezes por engano executa o resto da
 * cadeia em dobro, e o sintoma aparece longe da causa.
 */

import { createServer } from 'node:http';
import { METODOS, Roteador } from './roteador.js';
import { enriquecer } from './resposta.js';

/** Erro com status HTTP, para interromper a requisição de propósito. */
export class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.name = 'ErroHttp';
    this.status = status;
  }
}

export class Servidor {
  constructor({ registrar = false } = {}) {
    this.roteador = new Roteador();
    this.middlewares = [];
    this.aoErrar = null;
    this.registrar = registrar;
    this.servidor = null;

    for (const metodo of METODOS) {
      const nome = metodo.toLowerCase();
      this[nome] = (padrao, ...manipuladores) => {
        this.roteador.registrar(metodo, padrao, ...manipuladores);
        return this;
      };
    }
  }

  /** Acrescenta um middleware, que roda antes das rotas. */
  usar(middleware) {
    if (typeof middleware !== 'function') {
      throw new TypeError('O middleware precisa ser uma função.');
    }

    this.middlewares.push(middleware);
    return this;
  }

  /** Define o tratamento de erro. */
  aoFalhar(manipulador) {
    this.aoErrar = manipulador;
    return this;
  }

  /** O manipulador que o `node:http` chama. */
  get manipulador() {
    return (requisicao, resposta) => this.atender(requisicao, resposta);
  }

  async atender(requisicao, resposta) {
    enriquecer(resposta);

    const endereco = new URL(requisicao.url, 'http://local');
    requisicao.caminho = endereco.pathname;
    requisicao.consulta = Object.fromEntries(endereco.searchParams);
    requisicao.parametros = Object.create(null);

    try {
      const achado = this.roteador.procurar(requisicao.method, requisicao.caminho);

      if (achado !== null) {
        requisicao.parametros = achado.parametros;
        requisicao.rota = achado.rota.padrao;
      }

      const cadeia = [...this.middlewares, ...(achado?.manipuladores ?? [this.naoEncontrado()])];
      await this.executar(cadeia, requisicao, resposta);

      if (!resposta.writableEnded) {
        resposta.vazio(204);
      }
    } catch (erro) {
      await this.tratar(erro, requisicao, resposta);
    }
  }

  async executar(cadeia, requisicao, resposta) {
    let ultimoChamado = -1;

    const chamar = async (indice) => {
      if (indice <= ultimoChamado) {
        throw new Error('proximo() foi chamado mais de uma vez pelo mesmo middleware.');
      }

      ultimoChamado = indice;

      if (indice >= cadeia.length || resposta.writableEnded) {
        return undefined;
      }

      return cadeia[indice](requisicao, resposta, () => chamar(indice + 1));
    };

    await chamar(0);
  }

  naoEncontrado() {
    return (requisicao, resposta) => {
      const metodos = this.roteador.metodosPara(requisicao.caminho);

      // O recurso existe e o verbo é que está errado: 405 com Allow diz isso,
      // 404 esconde e faz quem integra perder tempo.
      if (metodos.length > 0) {
        resposta.setHeader('Allow', metodos.join(', '));
        return resposta.problema(405, `Use ${metodos.join(' ou ')} em ${requisicao.caminho}.`);
      }

      return resposta.problema(404, `Nada em ${requisicao.caminho}.`);
    };
  }

  async tratar(erro, requisicao, resposta) {
    if (this.registrar) {
      console.error(`[erro] ${requisicao.method} ${requisicao.url}`, erro);
    }

    if (resposta.writableEnded) {
      return;
    }

    if (this.aoErrar) {
      await this.aoErrar(erro, requisicao, resposta);

      if (resposta.writableEnded) {
        return;
      }
    }

    const status = Number.isInteger(erro?.status) ? erro.status : 500;

    // A mensagem de um erro inesperado não vai para o cliente: ela costuma
    // trazer caminho de arquivo e detalhe de infraestrutura.
    const detalhe = status >= 500 ? 'Erro interno.' : erro.message;

    resposta.problema(status, detalhe);
  }

  /** Sobe o servidor. Porta 0 deixa o sistema escolher uma livre. */
  async ouvir(porta = 0, maquina = '127.0.0.1') {
    this.servidor = createServer(this.manipulador);

    await new Promise((cumprir, rejeitar) => {
      this.servidor.once('error', rejeitar);
      this.servidor.listen(porta, maquina, cumprir);
    });

    return this.endereco;
  }

  /** O endereço em que o servidor está ouvindo. */
  get endereco() {
    const atual = this.servidor?.address();
    return atual === null || atual === undefined ? null : `http://${atual.address}:${atual.port}`;
  }

  /** Derruba o servidor. */
  async fechar() {
    if (this.servidor === null) {
      return;
    }

    await new Promise((cumprir) => this.servidor.close(cumprir));
    this.servidor = null;
  }
}

/** Atalho para criar um servidor. */
export function servidor(opcoes) {
  return new Servidor(opcoes);
}
