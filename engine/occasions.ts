import type { Person, Ms } from './types';
import { startOfDay, DAY } from './time';

export function nextOccurrence(month: number, day: number, now: Ms): Ms {
  const y = new Date(now).getFullYear();
  let t = new Date(y, month - 1, day).getTime();
  if (t < startOfDay(now)) t = new Date(y + 1, month - 1, day).getTime();
  return t;
}

export interface UpcomingBirthday { person: Person; date: Ms; inDays: number; turning?: number }

export function upcomingBirthdays(people: Person[], now: Ms, withinDays = 30): UpcomingBirthday[] {
  return people.filter(p => p.birthday).map(p => {
    const date = nextOccurrence(p.birthday!.month, p.birthday!.day, now);
    const inDays = Math.round((date - startOfDay(now)) / DAY);
    return { person: p, date, inDays, turning: p.birthday!.year ? new Date(date).getFullYear() - p.birthday!.year : undefined };
  }).filter(b => b.inDays <= withinDays).sort((a, b) => a.date - b.date || a.person.name.localeCompare(b.person.name));
}

/** People you share the most calendar events with (from your own connected calendar). */
export function frequentPeople(attendees: Record<string, number>, people: Person[], limit = 5): { name: string; count: number }[] {
  const known = new Set(people.map(p => p.name.toLowerCase()));
  return Object.entries(attendees).filter(([n, c]) => c >= 2 && !known.has(n.toLowerCase())).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([name, count]) => ({ name, count }));
}
