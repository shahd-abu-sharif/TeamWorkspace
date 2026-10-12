import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorState } from './Dashboard';

interface ReportData {
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byWorkstream: Record<string, number>;
  hours: { estimated: number; actual: number };
  onTime: { completed: number; onTime: number; late: number; percent: number };
  totalCompleted: number;
}

export function ReportsPage() {
  const { t } = useTranslation();
  const { role } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ['reports'],
    queryFn: () => apiClient.get<ReportData>('/reports'),
    enabled: role === 'LEADER',
  });
  if (error) return <ErrorState message={(error as Error).message} />;
  const totalTasks = Object.values(data?.byStatus ?? {}).reduce((sum, count) => sum + count, 0);

  return <div className="mx-auto max-w-6xl space-y-7">
    <header><h1 className="text-2xl font-semibold">{t('nav.reports')}</h1><p className="mt-1 text-sm text-gray-500">{t('reports.subtitle')}</p></header>
    {isLoading ? <div className="grid gap-4 md:grid-cols-2">{[0,1,2,3].map((item) => <div key={item} className="h-48 animate-pulse rounded-xl bg-gray-100" />)}</div> : data && <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label={t('reports.totalTasks')} value={totalTasks} />
        <Metric label={t('reports.completed')} value={data.totalCompleted} />
        <Metric label={t('reports.onTimeRate')} value={`${data.onTime.percent}%`} />
        <Metric label={t('reports.loggedHours')} value={`${data.hours.actual}h / ${data.hours.estimated}h`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Breakdown title={t('reports.byStatus')} values={data.byStatus} total={totalTasks} label={(key) => t(`status.${key}`)} />
        <Breakdown title={t('reports.byPriority')} values={data.byPriority} total={totalTasks} label={(key) => t(`priority.${key}`)} />
        <Breakdown title={t('reports.byWorkstream')} values={data.byWorkstream} total={totalTasks} label={(key) => key === 'Unassigned' ? t('dashboard.unassigned') : key} />
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold">{t('reports.deadlinePerformance')}</h2>
          <div className="mb-3 h-3 overflow-hidden rounded-full bg-red-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${data.onTime.percent}%` }} /></div>
          <div className="flex justify-between text-sm"><span>{t('reports.onTime', { count: data.onTime.onTime })}</span><span>{t('reports.late', { count: data.onTime.late })}</span></div>
        </section>
      </div>
    </>}
  </div>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><p className="text-sm text-gray-500">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></section>;
}

function Breakdown({ title, values, total, label }: { title: string; values: Record<string, number>; total: number; label: (key: string) => string }) {
  return <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
    <h2 className="mb-4 font-semibold">{title}</h2>
    <div className="space-y-3">{Object.entries(values).sort(([, a], [, b]) => b - a).map(([key, count]) => <div key={key}>
      <div className="mb-1 flex justify-between gap-3 text-sm"><span className="truncate">{label(key)}</span><span className="text-gray-500">{count}</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-[#2563EB]" style={{ width: `${total ? Math.max(3, (count / total) * 100) : 0}%` }} /></div>
    </div>)}</div>
  </section>;
}
