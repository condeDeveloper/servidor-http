/**
 * Os atalhos de resposta.
 *
 * O `http.ServerResponse` do Node é de baixo nível de propósito, e escrever
 * `setHeader` + `writeHead` + `end` em toda rota cansa. Estes atalhos são
 * acrescentados ao objeto de resposta no começo da requisição.
 */

import { serializar, apagar } from './cookies.js';

/** Frases dos status que este servidor usa nos atalhos. */
export const FRASES = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};

/** Acrescenta os atalhos ao objeto de resposta. */
export function enriquecer(resposta) {
  resposta.status = function status(codigo) {
    this.statusCode = codigo;
    return this;
  };

  resposta.cabecalho = function cabecalho(nome, valor) {
    this.setHeader(nome, valor);
    return this;
  };

  resposta.tipo = function tipo(valor) {
    return this.cabecalho('Content-Type', valor);
  };

  resposta.json = function json(dados, codigo) {
    if (codigo !== undefined) this.statusCode = codigo;

    const corpo = JSON.stringify(dados);
    this.setHeader('Content-Type', 'application/json; charset=utf-8');
    this.setHeader('Content-Length', Buffer.byteLength(corpo));
    this.end(corpo);
    return this;
  };

  resposta.texto = function texto(conteudo, codigo) {
    if (codigo !== undefined) this.statusCode = codigo;

    const corpo = String(conteudo);
    this.setHeader('Content-Type', 'text/plain; charset=utf-8');
    this.setHeader('Content-Length', Buffer.byteLength(corpo));
    this.end(corpo);
    return this;
  };

  resposta.html = function html(conteudo, codigo) {
    if (codigo !== undefined) this.statusCode = codigo;

    const corpo = String(conteudo);
    this.setHeader('Content-Type', 'text/html; charset=utf-8');
    this.setHeader('Content-Length', Buffer.byteLength(corpo));
    this.end(corpo);
    return this;
  };

  resposta.vazio = function vazio(codigo = 204) {
    this.statusCode = codigo;
    // 204 não pode ter corpo nem Content-Length: agente que recebe os dois
    // fica esperando bytes que nunca chegam.
    this.removeHeader('Content-Type');
    this.removeHeader('Content-Length');
    this.end();
    return this;
  };

  resposta.redirecionar = function redirecionar(destino, codigo = 302) {
    this.statusCode = codigo;
    this.setHeader('Location', destino);
    this.end();
    return this;
  };

  resposta.cookie = function cookie(nome, valor, opcoes) {
    return acrescentar(this, serializar(nome, valor, opcoes));
  };

  resposta.apagarCookie = function apagarCookie(nome, opcoes) {
    return acrescentar(this, apagar(nome, opcoes));
  };

  resposta.problema = function problema(codigo, detalhe) {
    return this.json(
      {
        titulo: FRASES[codigo] ?? 'Erro',
        detalhe,
        status: codigo,
      },
      codigo,
    );
  };

  return resposta;
}

function acrescentar(resposta, valor) {
  // Set-Cookie é o único cabeçalho que pode repetir, então ele acumula em
  // lista em vez de sobrescrever.
  const atuais = resposta.getHeader('Set-Cookie');
  const todos = atuais === undefined ? [valor] : [].concat(atuais, valor);

  resposta.setHeader('Set-Cookie', todos);
  return resposta;
}
