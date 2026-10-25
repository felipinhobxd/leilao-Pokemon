export function parsePollGame(input: {kind?: unknown; options?: unknown; correctIndex?: unknown; prizeName?: unknown; question?: unknown}) {
  const kind = input.kind === 'quiz' ? 'quiz' : input.kind === 'giveaway' ? 'giveaway' : input.kind === 'legacy' || input.kind == null ? 'legacy' : '';
  const options = Array.isArray(input.options) ? input.options.map(value => String(value ?? '').trim()) : [];
  if (!kind || options.length < 2 || options.length > 12 || options.some(value => !value || value.length > 100) || new Set(options).size !== options.length) throw new Error('Use de 2 a 12 opções diferentes, com até 100 caracteres cada.');
  const prizeName = String(input.prizeName ?? '').trim();
  const question = String(input.question ?? '').trim();
  const correctIndex = input.correctIndex;
  if (kind !== 'legacy' && (!Number.isInteger(correctIndex) || Number(correctIndex) < 0 || Number(correctIndex) >= options.length)) throw new Error('Selecione a única opção correta.');
  if (kind !== 'legacy' && (!prizeName || prizeName.length > 200)) throw new Error('Informe o nome da carta ou prêmio (até 200 caracteres).');
  if (kind === 'quiz' && (!question || question.length > 200)) throw new Error('Informe a pergunta do quiz (até 200 caracteres).');
  return {kind, options, correctIndex: kind === 'legacy' ? null : Number(correctIndex), prizeName, question};
}
import type { SupabaseClient } from '@supabase/supabase-js';

export async function requireGameBot(db: SupabaseClient) {
  const {data,error} = await db.from('whatsapp_bot_workers').select('version').order('heartbeat_at',{ascending:false,nullsFirst:false}).limit(1).maybeSingle();
  const version = String(data?.version ?? '').split('.').map(Number);
  if (error || !(version[0]>0 || version[1]>2 || version[1]===2 && version[2]>=9)) throw new Error('Reabra o bot atualizado (0.2.9 ou superior) antes de criar brindes com vencedor ou quizzes.');
}
