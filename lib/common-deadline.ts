import { toBrasiliaInput, brasiliaInputToIso } from './brasilia-time.ts';

export function defaultCommonEndInput(now = new Date()): string {
  const candidate = `${toBrasiliaInput(now).slice(0,10)}T01:00`;
  const iso = brasiliaInputToIso(candidate);
  if (iso && Date.parse(iso)>now.getTime()) return candidate;
  return toBrasiliaInput(new Date(Date.parse(iso ?? now.toISOString())+86_400_000));
}

export function validateCommonDeadline(endsAt: string, startsAt: string, itemCount: number, intervalSeconds: number): boolean {
  const end=Date.parse(endsAt),start=Date.parse(startsAt);
  return Number.isFinite(end) && Number.isFinite(start) && end>start+(itemCount-1)*intervalSeconds*1000 && end<=start+604_800_000;
}
