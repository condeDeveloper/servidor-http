/**
 * Servidor HTTP do zero sobre `node:http`.
 *
 *     import { servidor, corpo, cookies } from 'servidor-http';
 *
 *     const app = servidor();
 *     app.usar(corpo()).usar(cookies());
 *     app.get('/pedidos/:id', (req, res) => res.json({ id: req.parametros.id }));
 *     await app.ouvir(3000);
 */

export { Servidor, servidor, ErroHttp } from './servidor.js';
export { Roteador, METODOS } from './roteador.js';
export { Rota, ErroDeRota, segmentos } from './rota.js';
export { corpo, ler, lerJson, lerTexto, lerFormulario, lerBytes, ErroDeCorpo, LIMITE_PADRAO } from './corpo.js';
export { cookies, analisar as analisarCookies, serializar as serializarCookie, apagar as apagarCookie } from './cookies.js';
export { estaticos, tipoDe, resolverDentro, TIPOS } from './estaticos.js';
export { enriquecer, FRASES } from './resposta.js';
