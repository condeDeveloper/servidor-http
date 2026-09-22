import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { cookies } from '../src/cookies.js';
import { corpo } from '../src/corpo.js';
import { estaticos, resolverDentro, tipoDe } from '../src/estaticos.js';
import { ErroHttp, servidor } from '../src/servidor.js';

/** Sobe um servidor em porta livre e devolve um `buscar` já apontado nele. */
async function subir(montar) {
  const app = servidor();
  montar(app);

  const endereco = await app.ouvir(0);

  return {
    app,
    buscar: (caminho, opcoes) => fetch(endereco + caminho, opcoes),
    fechar: () => app.fechar(),
  };
}

describe('servidor', () => {
  it('responde uma rota simples', async () => {
    const { buscar, fechar } = await subir((app) => {
      app.get('/oi', (req, res) => res.texto('olá'));
    });

    const resposta = await buscar('/oi');

    assert.equal(resposta.status, 200);
    assert.equal(await resposta.text(), 'olá');
    await fechar();
  });

  it('entrega os parâmetros da rota', async () => {
    const { buscar, fechar } = await subir((app) => {
      app.get('/pedidos/:id', (req, res) => res.json({ id: req.parametros.id }));
    });

    assert.deepEqual(await (await buscar('/pedidos/42')).json(), { id: '42' });
    await fechar();
  });

  it('entrega a query', async () => {
    const { buscar, fechar } = await subir((app) => {
      app.get('/busca', (req, res) => res.json(req.consulta));
    });

    assert.deepEqual(await (await buscar('/busca?q=caneta&n=3')).json(), { q: 'caneta', n: '3' });
    await fechar();
  });

  it('lê o corpo em JSON', async () => {
    const { buscar, fechar } = await subir((app) => {
      app.usar(corpo());
      app.post('/eco', (req, res) => res.json(req.corpo));
    });

    const resposta = await buscar('/eco', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    });

    assert.deepEqual(await resposta.json(), { a: 1 });
    await fechar();
  });

  it('caminho desconhecido devolve 404', async () => {
    const { buscar, fechar } = await subir((app) => {
      app.get('/oi', (req, res) => res.texto('olá'));
    });

    assert.equal((await buscar('/nada')).status, 404);
    await fechar();
  });

  it('verbo errado devolve 405 com Allow', async () => {
    // O recurso existe; dizer 404 aqui faria quem integra perder tempo.
    const { buscar, fechar } = await subir((app) => {
      app.get('/pedidos', (req, res) => res.json([]));
      app.post('/pedidos', (req, res) => res.vazio(201));
    });

    const resposta = await buscar('/pedidos', { method: 'DELETE' });

    assert.equal(resposta.status, 405);
    assert.equal(resposta.headers.get('allow'), 'GET, POST');
    await fechar();
  });

  it('a cadeia de middleware roda na ordem', async () => {
    const passos = [];

    const { buscar, fechar } = await subir((app) => {
      app.usar((req, res, proximo) => {
        passos.push('um');
        return proximo();
      });
      app.usar((req, res, proximo) => {
        passos.push('dois');
        return proximo();
      });
      app.get('/a', (req, res) => {
        passos.push('rota');
        res.vazio();
      });
    });

    await buscar('/a');

    assert.deepEqual(passos, ['um', 'dois', 'rota']);
    await fechar();
  });

  it('middleware que responde interrompe a cadeia', async () => {
    let chegou = false;

    const { buscar, fechar } = await subir((app) => {
      app.usar((req, res) => res.problema(401, 'Sem credencial.'));
      app.get('/a', (req, res) => {
        chegou = true;
        res.vazio();
      });
    });

    assert.equal((await buscar('/a')).status, 401);
    assert.equal(chegou, false);
    await fechar();
  });

  it('chamar proximo duas vezes levanta erro na cadeia', async () => {
    // Sem a trava, o resto da cadeia rodaria em dobro e o sintoma apareceria
    // longe da causa. O teste é no nível da cadeia porque, numa requisição
    // real, quando o segundo proximo() estoura a resposta já foi enviada.
    const app = servidor();
    const cadeia = [
      async (req, res, proximo) => {
        await proximo();
        await proximo();
      },
      () => {},
    ];

    await assert.rejects(
      () => app.executar(cadeia, {}, { writableEnded: false }),
      /mais de uma vez/,
    );
  });

  it('depois da resposta enviada o cliente ainda recebe a primeira', async () => {
    // A trava protege a cadeia, não desfaz o que já foi para a rede: o
    // cliente vê o 200 que já saiu, e o erro fica do lado do servidor.
    const { buscar, fechar } = await subir((app) => {
      app.usar(async (req, res, proximo) => {
        await proximo();
        await proximo().catch(() => {});
      });
      app.get('/a', (req, res) => res.texto('ok'));
    });

    const resposta = await buscar('/a');

    assert.equal(resposta.status, 200);
    assert.equal(await resposta.text(), 'ok');
    await fechar();
  });

  it('erro com status vira aquele status', async () => {
    const { buscar, fechar } = await subir((app) => {
      app.get('/a', () => {
        throw new ErroHttp(422, 'Faltou o campo nome.');
      });
    });

    const resposta = await buscar('/a');

    assert.equal(resposta.status, 422);
    assert.equal((await resposta.json()).detalhe, 'Faltou o campo nome.');
    await fechar();
  });

  it('erro inesperado vira 500 sem vazar a mensagem', async () => {
    const { buscar, fechar } = await subir((app) => {
      app.get('/a', () => {
        throw new Error('senha do banco: 1234');
      });
    });

    const resposta = await buscar('/a');
    const corpoDaResposta = await resposta.json();

    assert.equal(resposta.status, 500);
    assert.equal(corpoDaResposta.detalhe, 'Erro interno.');
    assert.ok(!JSON.stringify(corpoDaResposta).includes('1234'));
    await fechar();
  });

  it('o tratador de erro próprio tem prioridade', async () => {
    const { buscar, fechar } = await subir((app) => {
      app.aoFalhar((erro, req, res) => res.json({ meu: erro.message }, 418));
      app.get('/a', () => {
        throw new Error('previsto');
      });
    });

    const resposta = await buscar('/a');

    assert.equal(resposta.status, 418);
    assert.deepEqual(await resposta.json(), { meu: 'previsto' });
    await fechar();
  });

  it('rota que não responde nada devolve 204', async () => {
    const { buscar, fechar } = await subir((app) => {
      app.get('/a', () => {});
    });

    const resposta = await buscar('/a');

    assert.equal(resposta.status, 204);
    assert.equal(await resposta.text(), '');
    await fechar();
  });

  it('lê e escreve cookie', async () => {
    const { buscar, fechar } = await subir((app) => {
      app.usar(cookies());
      app.get('/entrar', (req, res) => res.cookie('sessao', 'abc').vazio());
      app.get('/quem', (req, res) => res.json({ sessao: req.cookies.sessao ?? null }));
    });

    const entrada = await buscar('/entrar');
    assert.match(entrada.headers.get('set-cookie'), /sessao=abc/);

    const quem = await buscar('/quem', { headers: { cookie: 'sessao=abc' } });
    assert.deepEqual(await quem.json(), { sessao: 'abc' });
    await fechar();
  });

  it('dois cookies viram dois Set-Cookie', async () => {
    const { buscar, fechar } = await subir((app) => {
      app.get('/a', (req, res) => res.cookie('um', '1').cookie('dois', '2').vazio());
    });

    const todos = (await buscar('/a')).headers.getSetCookie();

    assert.equal(todos.length, 2);
    await fechar();
  });

  it('redireciona', async () => {
    const { buscar, fechar } = await subir((app) => {
      app.get('/velho', (req, res) => res.redirecionar('/novo', 301));
      app.get('/novo', (req, res) => res.texto('aqui'));
    });

    const resposta = await buscar('/velho', { redirect: 'manual' });

    assert.equal(resposta.status, 301);
    assert.equal(resposta.headers.get('location'), '/novo');
    await fechar();
  });

  it('o endereço fica disponível depois de subir', async () => {
    const { app, fechar } = await subir(() => {});

    assert.match(app.endereco, /^http:\/\/127\.0\.0\.1:\d+$/);
    await fechar();
    assert.equal(app.endereco, null);
  });

  it('recusa middleware que não é função', () => {
    assert.throws(() => servidor().usar('oi'), TypeError);
  });
});

describe('estáticos', () => {
  let pasta;

  before(async () => {
    pasta = await mkdtemp(join(tmpdir(), 'servidor-http-'));
    await writeFile(join(pasta, 'index.html'), '<h1>raiz</h1>');
    await writeFile(join(pasta, 'a.txt'), 'conteudo');
  });

  it('serve um arquivo', async () => {
    const { buscar, fechar } = await subir((app) => app.usar(estaticos(pasta)));

    const resposta = await buscar('/a.txt');

    assert.equal(await resposta.text(), 'conteudo');
    assert.match(resposta.headers.get('content-type'), /text\/plain/);
    await fechar();
  });

  it('serve o índice da pasta', async () => {
    const { buscar, fechar } = await subir((app) => app.usar(estaticos(pasta)));

    assert.match(await (await buscar('/')).text(), /raiz/);
    await fechar();
  });

  it('arquivo que não existe segue para a próxima rota', async () => {
    const { buscar, fechar } = await subir((app) => {
      app.usar(estaticos(pasta));
      app.get('/nada.txt', (req, res) => res.texto('da rota'));
    });

    assert.equal(await (await buscar('/nada.txt')).text(), 'da rota');
    await fechar();
  });

  it('não deixa escapar da pasta', async () => {
    // O ataque mais antigo que existe em servidor web.
    const { buscar, fechar } = await subir((app) => app.usar(estaticos(pasta)));

    for (const caminho of ['/../../etc/passwd', '/..%2f..%2fetc%2fpasswd', '/%2e%2e/%2e%2e/etc/passwd']) {
      const resposta = await buscar(caminho);
      assert.ok(resposta.status === 403 || resposta.status === 404, `${caminho} devolveu ${resposta.status}`);
    }

    await fechar();
  });

  it('resolve dentro da raiz e recusa caminho relativo que escapa', () => {
    assert.ok(resolverDentro(pasta, '/a.txt').endsWith('a.txt'));

    // Com barra inicial o próprio normalize já colapsa os ".." na raiz, então
    // "/../fora.txt" vira "/fora.txt" e continua dentro. A trava existe para
    // quem chama com caminho relativo, que é onde a fuga acontece de verdade.
    assert.ok(resolverDentro(pasta, '/../fora.txt').endsWith('fora.txt'));
    assert.equal(resolverDentro(pasta, '../fora.txt'), null);
    assert.equal(resolverDentro(pasta, '../../etc/passwd'), null);
  });

  it('descobre o tipo pela extensão', () => {
    assert.match(tipoDe('a.html'), /text\/html/);
    assert.match(tipoDe('a.png'), /image\/png/);
    assert.equal(tipoDe('a.desconhecido'), 'application/octet-stream');
  });

  after(() => {});
});
