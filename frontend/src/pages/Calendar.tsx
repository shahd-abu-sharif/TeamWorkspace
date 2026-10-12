import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../lib/api';

interface CalendarTask {
  id: string;
  reference: number;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  startDate: string | null;
}

export function CalendarPage() {
  const { t, i18n } = useTranslation();
  const [monthOffset, setMonthOffset] = useState(0);
  const month = useMemo(() => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() + monthOffset);
    return date;
  }, [monthOffset]);
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const from = new Date(start.getFullYear(), start.getMonth(), 1 - ((start.getDay() + 6) % 7));
  const to = new Date(end.getFullYear(), end.getMonth(), end.getDate() + (7 - ((end.getDay() + 6) % 7) - 1));

  const { data, isLoading } = useQuery({
    queryKey: ['calendar', from.toISOString(), to.toISOString()],
    queryFn: () => apiClient.get<{ items: CalendarTask[] }>(`/tasks?pageSize=200&dueFrom=${from.toISOString()}&dueTo=${to.toISOString()}&sort=dueDate&order=asc`),
  });
  const tasksByDay = new Map<string, CalendarTask[]>();
  for (const task of data?.items ?? []) {
    const date = task.dueDate ?? task.startDate;
    if (!date) continue;
    const key = new Date(date).toLocaleDateString('en-CA');
    tasksByDay.set(key, [...(tasksByDay.get(key) ?? []), task]);
  }
  const days = Array.from({ length: Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1 }, (_, index) => {
    const date = new Date(from);
    date.setDate(from.getDate() + index);
    return date;
  });
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(2024, 0, 1 + index);
    return new Intl.DateTimeFormat(i18n.language, { weekday: 'short' }).format(day);
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">{t('nav.calendar')}</h1><p className="text-sm text-gray-500">{t('calendar.subtitle')}</p></div>
        <div className="flex items-center gap-2">
          <button onClick={() => setMonthOffset((value) => value - 1)} className="rounded-md border border-gray-200 p-2 hover:bg-gray-50" aria-label={t('calendar.previous')}><ChevronLeft className="size-4 rtl:rotate-180" /></button>
          <span className="min-w-36 text-center font-medium">{month.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' })}</span>
          <button onClick={() => setMonthOffset((value) => value + 1)} className="rounded-md border border-gray-200 p-2 hover:bg-gray-50" aria-label={t('calendar.next')}><ChevronRight className="size-4 rtl:rotate-180" /></button>
          <button onClick={() => setMonthOffset(0)} className="rounded-md border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50">{t('calendar.today')}</button>
        </div>
      </header>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
          {weekDays.map((day) => <div key={day} className="px-2 py-3 text-center text-xs font-semibold text-gray-500">{day}</div>)}
        </div>
        {isLoading ? <div className="grid grid-cols-7">{days.map((day) => <div key={day.toISOString()} className="h-28 animate-pulse border-b border-e border-gray-100 bg-gray-50" />)}</div> : <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = day.toLocaleDateString('en-CA');
            const isCurrentMonth = day.getMonth() === month.getMonth();
            const isToday = day.toDateString() === new Date().toDateString();
            return <div key={key} className={`min-h-28 border-b border-e border-gray-100 p-1.5 sm:p-2 ${isCurrentMonth ? '' : 'bg-gray-50/70'}`}>
              <div className={`mb-1 grid size-6 place-items-center rounded-full text-xs ${isToday ? 'bg-[#2563EB] font-semibold text-white' : isCurrentMonth ? 'text-gray-800' : 'text-gray-400'}`}>{day.getDate()}</div>
              <div className="space-y-1">
                {(tasksByDay.get(key) ?? []).slice(0, 3).map((task) => <Link key={task.id} to={`/tasks/${task.id}`} title={task.title} className="block truncate rounded bg-blue-50 px-1.5 py-1 text-[10px] font-medium text-[#1D4ED8] hover:bg-blue-100 sm:text-xs">{task.title}</Link>)}
                {(tasksByDay.get(key)?.length ?? 0) > 3 && <span className="block px-1 text-[10px] text-gray-500">{t('calendar.more', { count: (tasksByDay.get(key)?.length ?? 0) - 3 })}</span>}
              </div>
            </div>;
          })}
        </div>}
      </div>
      {!isLoading && !data?.items.length && <p className="text-center text-sm text-gray-500">{t('calendar.empty')}</p>}
    </div>
  );
}
