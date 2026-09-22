# servidor-http

Um mini framework HTTP escrito do zero sobre `node:http`. Roteador com
parâmetros, cadeia de middleware, leitura de corpo, cookies e arquivos
estáticos. **Zero dependências.**

```js
import { servidor, corpo, cookies } from './src/index.js';

const app = servidor();

app.usar(corpo()).usar(cookies());

app.get('/pedidos/:id', (req, res) => res.json({ id: req.parametros.id }));
app.post('/pedidos', (req, res) => res.json(req.corpo, 201));

await app.ouvir(3000);
```

## Por que existe

`node:http` entrega a requisição crua: sem rota, sem corpo lido, sem cookie.
Quem só usa Express nunca vê o que está sendo resolvido no meio — e são quatro
problemas independentes, cada um com uma armadilha própria.

### 1. A ordem das rotas não deveria importar

O erro clássico de roteador caseiro:

```js
app.get('/pedidos/:id', ...);   // registrada primeiro
app.get('/pedidos/novo', ...);  // nunca é alcançada
```

Aqui as rotas são ordenadas por **especificidade**, não por ordem de registro:
segmento literal vale mais que parâmetro, que vale mais que curinga. `/pedidos/novo`
ganha de `/pedidos/:id` mesmo tendo sido registrada depois.

### 2. Verbo errado não é 404

Se o caminho existe e só o método está errado, a resposta é **405 com `Allow`**:

```
DELETE /pedidos  →  405, Allow: GET, POST
```

Devolver 404 aí esconde a informação e faz quem está integrando perder tempo.

### 3. O corpo precisa de limite

Sem limite de tamanho, uma requisição com `Content-Length` mentindo enche a
memória do processo. O corte acontece **enquanto os pedaços chegam**, não depois
de juntar tudo — que é o detalhe que a maioria das implementações caseiras erra.

### 4. Arquivo estático é onde mora o *path traversal*

`GET /../../etc/passwd` é o ataque mais antigo em servidor web. A defesa não é
procurar `..` no texto, que escapa com `%2e%2e`: é resolver o caminho absoluto e
conferir que ele continua dentro da raiz.

## O que tem

| | |
| --- | --- |
| **Roteador** | `:parametro`, `*` curinga, ordenação por especificidade, 405 com `Allow` |
| **Middleware** | cadeia com `proximo()`, e uma trava que acusa se ele for chamado duas vezes |
| **Corpo** | JSON, formulário, texto e bytes, escolhidos pelo `Content-Type`, com limite |
| **Cookies** | leitura do `Cookie`, escrita de `Set-Cookie` com `HttpOnly`/`SameSite` por padrão |
| **Estáticos** | tipos por extensão, índice de pasta, cache e proteção contra fuga |
| **Resposta** | `json`, `texto`, `html`, `vazio`, `redirecionar`, `cookie`, `problema` |
| **Erros** | `ErroHttp` com status, tratador próprio, e 500 que **não vaza a mensagem** |

Sobre o último ponto: mensagem de erro inesperado costuma trazer caminho de
arquivo e detalhe de infraestrutura, então o 500 responde `"Erro interno."` e o
resto fica no log. Tem teste guardando isso.

## Detalhes que valem mencionar

**Parâmetros com protótipo nulo.** Uma rota `/a/:__proto__` não contamina a
cadeia de protótipos, porque o objeto de parâmetros nasce de `Object.create(null)`.

**`proximo()` chamado duas vezes é erro.** Sem a trava, o resto da cadeia roda em
dobro e o sintoma aparece longe da causa. Com ela, estoura na hora.

**204 não leva corpo nem `Content-Length`.** Agente que recebe os dois fica
esperando bytes que nunca chegam.

**`Set-Cookie` acumula.** É o único cabeçalho que pode repetir, então dois
cookies viram dois cabeçalhos, não uma sobrescrita.

## Rodando

```bash
npm test
```

86 testes com `node:test`, sem nenhuma dependência — nem de runtime, nem de
desenvolvimento. Node 20 ou mais novo.

## Limites conhecidos

- Sem HTTPS e sem HTTP/2: é `node:http` puro.
- Sem `multipart/form-data`, então não sobe arquivo.
- Sem compressão, sem ETag e sem requisição parcial (`Range`) nos estáticos.
- O roteador percorre a lista de rotas; para centenas de rotas, uma árvore de
  prefixos seria melhor.
- Sem montagem de sub-aplicação (`app.usar('/api', outroApp)`).

## Licença

MIT.
