// Giro Frota — robô diário de avisos (roda no GitHub Actions às 7h de Manaus).
// Confere cada locadora e manda uma notificação para os aparelhos dela se houver avisos.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

const PROJETO = process.env.GCLOUD_PROJECT || 'painel-locadora';
const LINK = process.env.APP_URL || 'https://painel-locadora.web.app/';
const TESTE = process.env.TESTE === '1'; // manda notificação mesmo sem avisos (para testar)

initializeApp({ projectId: PROJETO });
const db = getFirestore();
const fcm = getMessaging();

// "Hoje" no fuso de Manaus (YYYY-MM-DD)
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Manaus', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const parse = s => { const [y, m, d] = String(s).split('-').map(Number); return Date.UTC(y, (m || 1) - 1, d || 1); };
const dias = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
function addMeses(s, n) {
  const [y, m, d] = String(s).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  const ult = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, ult));
  return dt.toISOString().slice(0, 10);
}

// Mesmas regras do app
function oleoAviso(v) {
  const intKm = Number(v.intervaloKm) || 1000, intM = Number(v.intervaloMeses) || 3;
  const kmRest = (Number(v.kmUltimaTroca) || 0) + intKm - (Number(v.kmAtual) || 0);
  const diasRest = v.dataUltimaTroca ? dias(hoje, addMeses(v.dataUltimaTroca, intM)) : null;
  const margem = v.tipo === 'moto' ? 200 : 500;
  return kmRest <= margem || (diasRest !== null && diasRest <= 15);
}
const cobAtrasada = c => c.proximoVencimento && dias(hoje, c.proximoVencimento) < 0;
const cobHoje = c => c.proximoVencimento && dias(hoje, c.proximoVencimento) >= 0 && dias(hoje, c.proximoVencimento) <= 1;
const PRAZO_FOTO = 2; // dias para responder ao pedido antes de virar "atrasada"
// null (em dia ou aguardando), 'pedir' ou 'atrasada'
function kmSituacao(c, veiculos) {
  if (!c.veiculoId || !veiculos.some(v => v.id === c.veiculoId) || !c.telefone) return null;
  const base = c.ultimoKmRecebido || c.kmDesde;
  const desdeRec = base ? dias(base, hoje) : 999;
  const intervalo = Number(c.diasFoto) >= 1 ? Number(c.diasFoto) : 15;
  if (desdeRec < intervalo) return null;
  const pedido = c.ultimoPedidoKm && (!base || c.ultimoPedidoKm >= base) ? c.ultimoPedidoKm : null;
  if (!pedido) return 'pedir';
  return dias(pedido, hoje) >= PRAZO_FOTO ? 'atrasada' : null;
}
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

async function processar(uid, nome, extras = []) {
  const tokens = (await db.collection(`empresas/${uid}/push`).get()).docs.map(d => d.id);
  if (!tokens.length) return { nome, enviado: 0, motivo: 'sem aparelho' };
  const veiculos = (await db.collection(`empresas/${uid}/veiculos`).get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const clientes = (await db.collection(`empresas/${uid}/clientes`).get()).docs.map(d => ({ id: d.id, ...d.data() }));

  const oleo = veiculos.filter(oleoAviso).length;
  const atras = clientes.filter(cobAtrasada).length;
  const vence = clientes.filter(cobHoje).length;
  const km = clientes.filter(c => kmSituacao(c, veiculos) === 'pedir').length;
  const kmAtras = clientes.filter(c => kmSituacao(c, veiculos) === 'atrasada').length;

  const partes = [...extras];
  if (atras) partes.push(plural(atras, 'pagamento atrasado', 'pagamentos atrasados'));
  if (vence) partes.push(plural(vence, 'pagamento vencendo', 'pagamentos vencendo'));
  if (oleo) partes.push(plural(oleo, 'troca de óleo', 'trocas de óleo'));
  if (kmAtras) partes.push(plural(kmAtras, 'foto do KM atrasada', 'fotos do KM atrasadas'));
  if (km) partes.push(plural(km, 'pedido de foto do KM', 'pedidos de foto do KM'));
  if (!partes.length && !TESTE) return { nome, enviado: 0, motivo: 'sem avisos' };

  const corpo = partes.length ? partes.join(' · ') : 'Teste: as notificações estão funcionando.';
  let enviado = 0;
  for (const token of tokens) {
    try {
      await fcm.send({
        token,
        notification: { title: `Giro Frota — ${nome}`, body: corpo },
        data: { link: LINK },
        webpush: { fcmOptions: { link: LINK }, notification: { icon: LINK + 'icon-192.png', badge: LINK + 'icon-192.png', tag: 'avisos-diarios' } }
      });
      enviado++;
    } catch (e) {
      const code = e && (e.code || e.errorInfo && e.errorInfo.code) || '';
      if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(code)) {
        await db.doc(`empresas/${uid}/push/${token}`).delete().catch(() => {}); // aparelho que desinstalou
      } else console.error('Falha ao enviar para', nome, code || e.message);
    }
  }
  return { nome, enviado, motivo: corpo };
}

const usuarios = (await db.collection('usuarios').get()).docs;

// Contratos das locadoras que vencem em até 7 dias ou já venceram (aviso só para o administrador)
const AVISO_CONTRATO = 7;
const contratos = [];
for (const u of usuarios) {
  const p = u.data();
  if (p.role !== 'locadora' || p.ativo === false || !p.venceContrato) continue;
  const d = dias(hoje, p.venceContrato);
  if (d > AVISO_CONTRATO) continue;
  const nome = p.empresa || 'Locadora';
  contratos.push({ d, txt: d < 0 ? `contrato da ${nome} venceu` : d === 0 ? `contrato da ${nome} vence hoje` : `contrato da ${nome} vence em ${d} dia${d === 1 ? '' : 's'}` });
}
contratos.sort((a, b) => a.d - b.d);
const avisoContratos = contratos.length > 2
  ? [`${contratos.length} contratos de locadoras para renovar`]
  : contratos.map(c => c.txt.charAt(0).toUpperCase() + c.txt.slice(1));

let total = 0;
for (const u of usuarios) {
  const p = u.data();
  if (p.ativo === false) continue; // locadora suspensa
  const r = await processar(u.id, p.empresa || 'Minha locadora', p.role === 'admin' ? avisoContratos : []);
  total += r.enviado;
  console.log(`${r.nome}: ${r.enviado} notificação(ões) — ${r.motivo}`);
}
console.log(`Dia ${hoje}: ${total} notificação(ões) enviada(s).`);
