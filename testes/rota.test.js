import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ErroDeRota, Rota, segmentos } from '../src/rota.js';
import { Roteador } from '../src/roteador.js';

/**
 * Os parâmetros saem com protótipo nulo, e `deepEqual` estrito compara
 * protótipo. Achatar antes de comparar mantém o teste legível sem abrir mão
 * da proteção.
 */
const plano = (objeto) => (objeto === null ? null : { ...objeto });

describe('segmentos', () => {
  it('ignora barra repetida e barra final', () => {
    assert.deepEqual(segmentos('//a//b/'), ['a', 'b']);
  });

  it('a raiz não tem segmento nenhum', () => {
    assert.deepEqual(segmentos('/'), []);
  });

  it('entrada vazia não quebra', () => {
    assert.deepEqual(segmentos(undefined), []);
  });
});

describe('Rota', () => {
  it('casa um caminho literal', () => {
    assert.deepEqual(plano(new Rota('/pedidos').casar('/pedidos')), {});
  });

  it('não casa caminho diferente', () => {
    assert.equal(new Rota('/pedidos').casar('/clientes'), null);
  });

  it('a barra final não muda o resultado', () => {
    assert.deepEqual(plano(new Rota('/pedidos').casar('/pedidos/')), {});
  });

  it('extrai um parâmetro', () => {
    assert.deepEqual(plano(new Rota('/pedidos/:id').casar('/pedidos/42')), { id: '42' });
  });

  it('extrai vários parâmetros', () => {
    const achado = new Rota('/pedidos/:id/itens/:item').casar('/pedidos/7/itens/3');

    assert.deepEqual(plano(achado), { id: '7', item: '3' });
  });

  it('decodifica o parâmetro', () => {
    assert.deepEqual(plano(new Rota('/busca/:termo').casar('/busca/caf%C3%A9')), { termo: 'café' });
  });

  it('um parâmetro chamado __proto__ não contamina o objeto', () => {
    // É por isso que os parâmetros nascem com protótipo nulo: num objeto
    // comum, escrever em __proto__ mexeria na cadeia de protótipos em vez de
    // criar uma chave.
    const achado = new Rota('/a/:__proto__').casar('/a/valor');

    assert.equal(achado.__proto__, 'valor');
    assert.equal(Object.getPrototypeOf(achado), null);
    assert.equal(Object.getPrototypeOf({}), Object.prototype);
  });

  it('não casa quando falta segmento', () => {
    assert.equal(new Rota('/pedidos/:id').casar('/pedidos'), null);
  });

  it('não casa quando sobra segmento', () => {
    assert.equal(new Rota('/pedidos/:id').casar('/pedidos/1/itens'), null);
  });

  it('o curinga leva o resto do caminho', () => {
    assert.deepEqual(plano(new Rota('/arquivos/*').casar('/arquivos/a/b/c.txt')), { resto: 'a/b/c.txt' });
  });

  it('o curinga aceita resto vazio', () => {
    assert.deepEqual(plano(new Rota('/arquivos/*').casar('/arquivos')), { resto: '' });
  });

  it('lista os nomes dos parâmetros', () => {
    assert.deepEqual(new Rota('/a/:b/c/:d').parametros, ['b', 'd']);
  });

  it('literal é mais específico que parâmetro', () => {
    assert.ok(new Rota('/pedidos/novo').especificidade > new Rota('/pedidos/:id').especificidade);
  });

  for (const padrao of ['pedidos', '', null, 42]) {
    it(`recusa padrão sem barra inicial: ${JSON.stringify(padrao)}`, () => {
      assert.throws(() => new Rota(padrao), ErroDeRota);
    });
  }

  it('recusa parâmetro sem nome', () => {
    assert.throws(() => new Rota('/pedidos/:'), ErroDeRota);
  });

  it('recusa curinga fora do fim', () => {
    assert.throws(() => new Rota('/arquivos/*/nome'), ErroDeRota);
  });

  it('se descreve de volta', () => {
    assert.equal(String(new Rota('/a/:b')), '/a/:b');
  });
});

describe('Roteador', () => {
  const nada = () => {};

  it('encontra a rota pelo método e caminho', () => {
    const roteador = new Roteador().registrar('GET', '/pedidos', nada);

    assert.ok(roteador.procurar('GET', '/pedidos'));
    assert.equal(roteador.procurar('POST', '/pedidos'), null);
  });

  it('o método não diferencia maiúsculas', () => {
    const roteador = new Roteador().registrar('get', '/a', nada);

    assert.ok(roteador.procurar('GET', '/a'));
  });

  it('a rota mais específica ganha, mesmo registrada depois', () => {
    // É o erro clássico de roteador caseiro: /pedidos/:id engoliria
    // /pedidos/novo só por ter sido registrada antes.
    const roteador = new Roteador()
      .registrar('GET', '/pedidos/:id', nada)
      .registrar('GET', '/pedidos/novo', nada);

    assert.equal(roteador.procurar('GET', '/pedidos/novo').rota.padrao, '/pedidos/novo');
    assert.equal(roteador.procurar('GET', '/pedidos/7').rota.padrao, '/pedidos/:id');
  });

  it('o parâmetro ganha do curinga', () => {
    const roteador = new Roteador()
      .registrar('GET', '/a/*', nada)
      .registrar('GET', '/a/:b', nada);

    assert.equal(roteador.procurar('GET', '/a/x').rota.padrao, '/a/:b');
  });

  it('devolve os parâmetros junto', () => {
    const roteador = new Roteador().registrar('GET', '/pedidos/:id', nada);

    assert.deepEqual(plano(roteador.procurar('GET', '/pedidos/9').parametros), { id: '9' });
  });

  it('lista os métodos que atendem um caminho', () => {
    const roteador = new Roteador()
      .registrar('GET', '/pedidos', nada)
      .registrar('POST', '/pedidos', nada);

    assert.deepEqual(roteador.metodosPara('/pedidos'), ['GET', 'POST']);
    assert.deepEqual(roteador.metodosPara('/outro'), []);
  });

  it('guarda vários manipuladores por rota', () => {
    const roteador = new Roteador().registrar('GET', '/a', nada, nada);

    assert.equal(roteador.procurar('GET', '/a').manipuladores.length, 2);
  });

  it('lista as rotas registradas', () => {
    const roteador = new Roteador().registrar('GET', '/a', nada).registrar('POST', '/b', nada);

    assert.equal(roteador.quantidade, 2);
    assert.deepEqual(roteador.rotas.map((r) => r.padrao).sort(), ['/a', '/b']);
  });

  it('recusa método desconhecido', () => {
    assert.throws(() => new Roteador().registrar('MIAU', '/a', nada), TypeError);
  });

  it('recusa rota sem manipulador', () => {
    assert.throws(() => new Roteador().registrar('GET', '/a'), TypeError);
  });

  it('recusa manipulador que não é função', () => {
    assert.throws(() => new Roteador().registrar('GET', '/a', 'oi'), TypeError);
  });
});
