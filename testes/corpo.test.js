import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';

import { ErroDeCorpo, ler, lerBytes, lerFormulario, lerJson, lerTexto, tipoDe } from '../src/corpo.js';
import { analisar, apagar, serializar } from '../src/cookies.js';

/**
 * Formulários e cookies saem com protótipo nulo, de propósito: um campo
 * chamado __proto__ não pode mexer na cadeia de protótipos. Achatar antes de
 * comparar mantém o teste legível sem abrir mão disso.
 */
const plano = (objeto) => ({ ...objeto });

function requisicao(corpo, tipo) {
  const fluxo = Readable.from([Buffer.from(corpo)]);
  fluxo.headers = tipo ? { 'content-type': tipo } : {};
  return fluxo;
}

describe('corpo', () => {
  it('lê texto', async () => {
    assert.equal(await lerTexto(requisicao('oi')), 'oi');
  });

  it('lê bytes', async () => {
    assert.ok(Buffer.isBuffer(await lerBytes(requisicao('oi'))));
  });

  it('lê JSON', async () => {
    assert.deepEqual(await lerJson(requisicao('{"a":1}')), { a: 1 });
  });

  it('corpo vazio vira nulo no JSON', async () => {
    assert.equal(await lerJson(requisicao('  ')), null);
  });

  it('JSON inválido reclama com 400', async () => {
    await assert.rejects(() => lerJson(requisicao('{quebrado')), (erro) => {
      assert.ok(erro instanceof ErroDeCorpo);
      assert.equal(erro.status, 400);
      return true;
    });
  });

  it('lê formulário', async () => {
    assert.deepEqual(plano(await lerFormulario(requisicao('a=1&b=dois'))), { a: '1', b: 'dois' });
  });

  it('campo repetido no formulário vira lista', async () => {
    assert.deepEqual(plano(await lerFormulario(requisicao('tag=a&tag=b'))), { tag: ['a', 'b'] });
  });

  it('o formulário decodifica o escape', async () => {
    assert.deepEqual(plano(await lerFormulario(requisicao('nome=Jo%C3%A3o'))), { nome: 'João' });
  });

  it('o limite corta antes de encher a memória', async () => {
    await assert.rejects(() => lerBytes(requisicao('x'.repeat(100)), 10), (erro) => {
      assert.equal(erro.status, 413);
      return true;
    });
  });

  it('escolhe o formato pelo Content-Type', async () => {
    assert.deepEqual(await ler(requisicao('{"a":1}', 'application/json')), { a: 1 });
    assert.deepEqual(plano(await ler(requisicao('a=1', 'application/x-www-form-urlencoded'))), { a: '1' });
    assert.equal(await ler(requisicao('oi', 'text/plain')), 'oi');
  });

  it('o Content-Type com charset ainda é reconhecido', async () => {
    assert.deepEqual(await ler(requisicao('{"a":1}', 'application/json; charset=utf-8')), { a: 1 });
  });

  it('tipo desconhecido volta como bytes, sem reclamar', async () => {
    const lido = await ler(requisicao('abc', 'application/octet-stream'));

    assert.ok(Buffer.isBuffer(lido));
  });

  it('extrai o tipo sem os parâmetros', () => {
    assert.equal(tipoDe({ headers: { 'content-type': 'text/html; charset=utf-8' } }), 'text/html');
    assert.equal(tipoDe({ headers: {} }), '');
  });
});

describe('cookies', () => {
  it('lê o cabeçalho Cookie', () => {
    assert.deepEqual(plano(analisar('a=1; b=2')), { a: '1', b: '2' });
  });

  it('decodifica o valor', () => {
    assert.deepEqual(plano(analisar('nome=Jo%C3%A3o')), { nome: 'João' });
  });

  it('tira as aspas do valor', () => {
    assert.deepEqual(plano(analisar('a="1"')), { a: '1' });
  });

  it('o primeiro repetido vence', () => {
    assert.deepEqual(plano(analisar('a=1; a=2')), { a: '1' });
  });

  it('cabeçalho vazio ou ausente devolve nada', () => {
    assert.deepEqual(plano(analisar('')), {});
    assert.deepEqual(plano(analisar(undefined)), {});
  });

  it('pedaço sem igual é ignorado', () => {
    assert.deepEqual(plano(analisar('a=1; lixo; b=2')), { a: '1', b: '2' });
  });

  it('escape malformado não derruba a requisição', () => {
    assert.deepEqual(plano(analisar('a=%E0%A4%A')), { a: '%E0%A4%A' });
  });

  it('serializa com os padrões seguros', () => {
    const valor = serializar('sessao', 'abc');

    assert.match(valor, /^sessao=abc/);
    assert.match(valor, /HttpOnly/);
    assert.match(valor, /SameSite=Lax/);
    assert.match(valor, /Path=\//);
  });

  it('serializa os atributos escolhidos', () => {
    const valor = serializar('s', 'v', {
      maxAge: 60,
      caminho: '/area',
      dominio: 'exemplo.com',
      seguro: true,
      mesmoSite: 'Strict',
    });

    assert.match(valor, /Max-Age=60/);
    assert.match(valor, /Path=\/area/);
    assert.match(valor, /Domain=exemplo\.com/);
    assert.match(valor, /Secure/);
    assert.match(valor, /SameSite=Strict/);
  });

  it('soHttp falso tira o HttpOnly', () => {
    assert.ok(!serializar('s', 'v', { soHttp: false }).includes('HttpOnly'));
  });

  it('codifica o valor', () => {
    assert.match(serializar('s', 'a b'), /s=a%20b/);
  });

  it('apagar é escrever vazio com Max-Age zero', () => {
    const valor = apagar('sessao');

    assert.match(valor, /^sessao=;/);
    assert.match(valor, /Max-Age=0/);
  });

  it('recusa nome inválido', () => {
    assert.throws(() => serializar('no me', 'v'), TypeError);
    assert.throws(() => serializar('a=b', 'v'), TypeError);
  });

  it('recusa maxAge que não é inteiro', () => {
    assert.throws(() => serializar('s', 'v', { maxAge: 1.5 }), TypeError);
  });
});
