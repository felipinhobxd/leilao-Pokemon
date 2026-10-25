'use client';
import {useId} from 'react';

type Props={kind:'quiz'|'giveaway';options:string;correctIndex:string;question:string;onOptions:(value:string)=>void;onCorrect:(value:string)=>void;onQuestion:(value:string)=>void;disabled?:boolean};
export default function GameAnswerFields(props:Props){
  const hint=useId();
  const options=props.options.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  return <fieldset className="game-fields wide" disabled={props.disabled}><legend>{props.kind==='quiz'?'Configuração do quiz':'Opção vencedora do brinde'}</legend>
    {props.kind==='quiz'&&<label>Pergunta do quiz<input maxLength={200} value={props.question} onChange={e=>props.onQuestion(e.target.value)} placeholder="Ex.: Qual é a evolução do Pikachu?" required /></label>}
    <label>Opções da enquete (uma por linha, 2 a 12)<textarea rows={3} value={props.options} onChange={e=>props.onOptions(e.target.value)} aria-describedby={hint} /></label>
    <label>Única opção correta<select value={props.correctIndex} onChange={e=>props.onCorrect(e.target.value)} required><option value="">Selecione a resposta vencedora…</option>{options.map((option,index)=><option key={index} value={index}>{index+1}. {option}</option>)}</select></label>
    <p className="muted" id={hint}>A resposta correta fica no painel. Vence o primeiro acerto confirmado pelo bot; trocar ou retirar o voto depois não transfere o prêmio.</p>
  </fieldset>;
}
