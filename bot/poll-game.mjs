import { createHash } from 'node:crypto';

export function selectedGameOption(options, vote) {
  const selected=vote?.selectedOptions;
  if (!Array.isArray(selected) || selected.length!==1) return -1;
  const hash=Buffer.from(selected[0]).toString('hex');
  return options.findIndex(option=>createHash('sha256').update(option).digest('hex')===hash);
}

export async function handleGameVote({db,poll,pollUpdate,resolveIdentity,ensureParticipant,eventTime}) {
  if (poll.game_kind==='legacy' || poll.winner_event_id) return false;
  const index=selectedGameOption(poll.options,pollUpdate.vote);
  if (index<0 || index!==poll.correct_index) return false;
  const identity=await resolveIdentity(pollUpdate);
  if (!identity) return false;
  const participant=await ensureParticipant(identity);
  const {data,error}=await db.rpc('claim_quick_poll_prize',{
    p_poll_id:poll.id,p_participant_id:participant.id,p_option_index:index,
    p_event_id:`game:${poll.id}:${pollUpdate.pollUpdateMessageKey?.id}:${participant.id}`.slice(0,200),
    p_event_at:eventTime(pollUpdate.senderTimestampMs),
  });
  if(error)throw new Error(error.message);
  if(data?.finished)poll.winner_event_id='confirmed';
  return Boolean(data?.finished);
}

export function prizeWinnerText(who,prize) {
  return `🎉 Parabéns, ${who}, você acertou e ganhou ${prize}!`;
}
