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
  if (v.kmUltimaTroca === undefined || v.kmUltimaTroca === null || v.kmUltimaTroca === '') return true; // falta informar a última troca
  const intKm = Number(v.intervaloKm) || 1000, intM = Number(v.intervaloMeses) || 3;
  const kmRest = (Number(v.kmUltimaTroca) || 0) + intKm - (Number(v.kmAtual) || 0);
  const diasRest = v.dataUltimaTroca ? dias(hoje, addMeses(v.dataUltimaTroca, intM)) : null;
  const margem = v.tipo === 'moto' ? 200 : 500;
  return kmRest <= margem || (diasRest !== null && diasRest <= 15);
}
// Venda parcelada já quitada não gera mais cobrança
const quitado = c => c.modalidade === 'compra' && Number(c.totalParcelas) > 0 && Number(c.parcelasPagas) >= Number(c.totalParcelas);
const cobAtrasada = c => !quitado(c) && c.proximoVencimento && dias(hoje, c.proximoVencimento) < 0;
const cobHoje = c => !quitado(c) && c.proximoVencimento && dias(hoje, c.proximoVencimento) >= 0 && dias(hoje, c.proximoVencimento) <= 1;
const PRAZO_FOTO = 2; // dias para responder ao pedido antes de virar "atrasada"
// null (em dia ou aguardando), 'pedir' ou 'atrasada'
function kmSituacao(c, veiculos) {
  if (c.modalidade === 'compra' && Number(c.totalParcelas) > 0) return null; // venda parcelada: sem foto do KM
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

/* ---------- WhatsApp oficial (API da Meta) ----------
   Sem WA_TOKEN/WA_PHONE_ID o robô roda em SIMULAÇÃO: só mostra no registro o que enviaria. */
const WA_TOKEN = process.env.WA_TOKEN || '';
const WA_PHONE_ID = process.env.WA_PHONE_ID || '';
const WA_LANG = process.env.WA_LANG || 'pt_BR';
const SIMULACAO = !(WA_TOKEN && WA_PHONE_ID);
const BASE = LINK.replace(/[^/]*$/, '');
const fmtR = n => 'R$ ' + (Number(n) || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const fmtD = s => { const [y, m, d] = String(s).split('-'); return `${d}/${m}/${y}`; };
const waNum = t => { const n = String(t || '').replace(/\D/g, ''); return n.length <= 11 ? '55' + n : n; };
const limpa = s => String(s ?? '').replace(/[\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim() || '-';
let waEnviadas = 0, waSimuladas = 0, waFalhas = 0;
async function enviarWhats(telefone, modelo, params, rotulo) {
  const para = waNum(telefone);
  if (para.length < 12) { console.log(`  [WhatsApp] ${rotulo}: telefone inválido (${telefone})`); return false; }
  if (SIMULACAO) { waSimuladas++; console.log(`  [WhatsApp SIMULAÇÃO] ${rotulo} → ${para} · modelo "${modelo}" · ${params.map(limpa).join(' | ')}`); return true; }
  const r = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'template',
      template: { name: modelo, language: { code: WA_LANG }, components: [{ type: 'body', parameters: params.map(x => ({ type: 'text', text: limpa(x) })) }] } })
  }).catch(e => ({ ok: false, status: 0, text: async () => e.message }));
  if (r.ok) { waEnviadas++; console.log(`  [WhatsApp] ${rotulo} → ${para} · enviado`); return true; }
  waFalhas++; console.error(`  [WhatsApp] ${rotulo} → ${para} · FALHOU (${r.status}) ${(await r.text()).slice(0, 300)}`); return false;
}
/* Quando mandar cobrança automática ao cliente: 1 dia antes, no dia e atrasos (1º, 3º, 7º dia e depois a cada 7) */
function tipoCobranca(c, cfg) {
  if (quitado(c) || !c.proximoVencimento || !c.telefone || c.autoMsg === false || !c.token) return null;
  const d = dias(hoje, c.proximoVencimento);
  if (d === 1 && cfg.antes !== false) return 'lembrete';
  if (d === 0 && cfg.noDia !== false) return 'hoje';
  if (d < 0 && cfg.atraso !== false) { const a = -d; if (a === 1 || a === 3 || a === 7 || (a > 7 && a % 7 === 0)) return 'atraso'; }
  return null;
}
function descricao(c, veiculos) {
  const v = veiculos.find(x => x.id === c.veiculoId);
  const veic = v ? `${v.modelo} (${v.placa})` : 'veículo';
  if (c.modalidade === 'compra' && Number(c.totalParcelas) > 0) return `parcela ${(Number(c.parcelasPagas) || 0) + 1} de ${Number(c.totalParcelas)} do ${veic}`;
  return `locação do ${veic}`;
}

async function processar(uid, p, extras = []) {
  const nome = p.empresa || 'Minha locadora';
  const veiculos = (await db.collection(`empresas/${uid}/veiculos`).get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const clientesDocs = (await db.collection(`empresas/${uid}/clientes`).get()).docs;
  const clientes = clientesDocs.map(d => ({ id: d.id, ...d.data() }));

  // Veículos cuja troca de óleo é responsabilidade do cliente não geram aviso
  const oleoDoCliente = new Set(clientes.filter(c => (c.oleoPorConta === 'cliente' || (c.modalidade === 'compra' && Number(c.totalParcelas) > 0)) && c.veiculoId).map(c => c.veiculoId));
  const oleo = veiculos.filter(v => !oleoDoCliente.has(v.id) && oleoAviso(v)).length;
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

  // ---- Mensagens automáticas no WhatsApp ----
  const cfgDoc = await db.doc(`empresas/${uid}/config/auto`).get();
  const cfg = cfgDoc.exists ? cfgDoc.data() : {};
  const liberado = p.role === 'admin' || p.autoWhats === true; // o administrador libera por locadora
  let wa = 0;
  if (liberado && cfg.ativo === true) {
    for (const c of clientes) {
      const tipo = tipoCobranca(c, cfg);
      if (!tipo) continue;
      if (c.autoEnvio && c.autoEnvio.data === hoje) continue; // já enviado hoje
      const link = BASE + 'pagar.html?t=' + c.token;
      const primeiro = String(c.nome || '').split(' ')[0] || 'cliente';
      const desc = descricao(c, veiculos);
      const ok = tipo === 'atraso'
        ? await enviarWhats(c.telefone, 'cobranca_atraso', [primeiro, nome, desc, fmtR(c.valor), fmtD(c.proximoVencimento), link], `${nome} · ${c.nome} · atraso`)
        : await enviarWhats(c.telefone, 'cobranca_lembrete', [primeiro, nome, desc, fmtR(c.valor), tipo === 'hoje' ? `hoje (${fmtD(c.proximoVencimento)})` : `amanhã (${fmtD(c.proximoVencimento)})`, link], `${nome} · ${c.nome} · ${tipo}`);
      if (ok) { wa++; if (!SIMULACAO) await db.doc(`empresas/${uid}/clientes/${c.id}`).update({ autoEnvio: { data: hoje, tipo } }).catch(() => {}); }
    }
    // Resumo do dia para a própria locadora
    const telResumo = cfg.telefoneResumo || p.telefone;
    if (cfg.resumo !== false && telResumo && partes.length) {
      if (await enviarWhats(telResumo, 'resumo_locadora', [nome, partes.join(' · ')], `${nome} · resumo do dia`)) wa++;
    }
  }

  // ---- Notificação no celular (push) ----
  const tokens = (await db.collection(`empresas/${uid}/push`).get()).docs.map(d => d.id);
  if (!tokens.length) return { nome, enviado: 0, wa, motivo: 'sem aparelho' };
  if (!partes.length && !TESTE) return { nome, enviado: 0, wa, motivo: 'sem avisos' };
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
  return { nome, enviado, wa, motivo: corpo };
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

console.log(SIMULACAO ? 'WhatsApp em MODO SIMULAÇÃO (sem WA_TOKEN/WA_PHONE_ID): nada é enviado de verdade.' : 'WhatsApp oficial ATIVO.');
let total = 0;
for (const u of usuarios) {
  const p = u.data();
  if (p.ativo === false) continue; // locadora suspensa
  const r = await processar(u.id, p, p.role === 'admin' ? avisoContratos : []);
  total += r.enviado;
  console.log(`${r.nome}: ${r.enviado} notificação(ões) · ${r.wa} WhatsApp — ${r.motivo}`);
}
console.log(`Dia ${hoje}: ${total} notificação(ões) enviada(s). WhatsApp: ${waEnviadas} enviada(s), ${waSimuladas} simulada(s), ${waFalhas} falha(s).`);
