/**
 * O roteador: guarda as rotas e encontra qual atende a requisição.
 *
 * As rotas ficam agrupadas por método porque é o filtro mais barato, e dentro
 * de cada grupo ordenadas por especificidade — assim `/pedidos/novo` ganha de
 * `/pedidos/:id` mesmo tendo sido registrada depois. Deixar isso por conta da
 * ordem de registro é o erro mais comum em roteador caseiro, e o mais chato de
 * achar depois.
 */

import { Rota } from './rota.js';

/** Os métodos que o roteador aceita registrar. */
export const METODOS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** Uma rota registrada, com o que fazer quando ela casa. */
class Entrada {
  constructor(metodo, rota, manipuladores) {
    this.metodo = metodo;
    this.rota = rota;
    this.manipuladores = manipuladores;
  }
}

/** O que a busca encontrou. */
export class Achado {
  constructor(entrada, parametros) {
    this.entrada = entrada;
    this.parametros = parametros;
  }

  get manipuladores() {
    return this.entrada.manipuladores;
  }

  get rota() {
    return this.entrada.rota;
  }
}

export class Roteador {
  constructor() {
    this.porMetodo = new Map();
  }

  /** Registra uma rota. */
  registrar(metodo, padrao, ...manipuladores) {
    const normalizado = String(metodo).toUpperCase();

    if (!METODOS.includes(normalizado)) {
      throw new TypeError(`Método desconhecido: ${metodo}. Conhecidos: ${METODOS.join(', ')}.`);
    }

    if (manipuladores.length === 0) {
      throw new TypeError(`A rota ${padrao} precisa de ao menos um manipulador.`);
    }

    for (const manipulador of manipuladores) {
      if (typeof manipulador !== 'function') {
        throw new TypeError(`O manipulador de ${padrao} precisa ser uma função.`);
      }
    }

    const entradas = this.porMetodo.get(normalizado) ?? [];
    entradas.push(new Entrada(normalizado, new Rota(padrao), manipuladores));

    // Mais específica primeiro; empate resolve pelo padrão mais longo, que é
    // uma heurística boba mas estável — e ordem estável importa para depurar.
    entradas.sort((uma, outra) => {
      const porEspecificidade = outra.rota.especificidade - uma.rota.especificidade;
      return porEspecificidade !== 0 ? porEspecificidade : outra.rota.padrao.length - uma.rota.padrao.length;
    });

    this.porMetodo.set(normalizado, entradas);
    return this;
  }

  /** Procura a rota que atende método e caminho. */
  procurar(metodo, caminho) {
    const entradas = this.porMetodo.get(String(metodo).toUpperCase()) ?? [];

    for (const entrada of entradas) {
      const parametros = entrada.rota.casar(caminho);

      if (parametros !== null) {
        return new Achado(entrada, parametros);
      }
    }

    return null;
  }

  /**
   * Os métodos que atendem um caminho, qualquer que seja o verbo.
   *
   * É o que permite responder 405 com o cabeçalho `Allow` em vez de 404: o
   * recurso existe, o verbo é que está errado, e essa diferença importa para
   * quem está integrando.
   */
  metodosPara(caminho) {
    const encontrados = [];

    for (const [metodo, entradas] of this.porMetodo) {
      if (entradas.some((entrada) => entrada.rota.casar(caminho) !== null)) {
        encontrados.push(metodo);
      }
    }

    return encontrados.sort();
  }

  /** Todas as rotas registradas, para inspeção. */
  get rotas() {
    const todas = [];

    for (const [metodo, entradas] of this.porMetodo) {
      for (const entrada of entradas) {
        todas.push({ metodo, padrao: entrada.rota.padrao });
      }
    }

    return todas;
  }

  /** Quantas rotas existem. */
  get quantidade() {
    return this.rotas.length;
  }
}
