// apps/web/src/pages/Timeline.tsx
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { apiClient } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Link } from 'react-router-dom';

type Zoom = 'day' | 'week' | 'month';

const DAY = 86_400_000;
const COLUMN_WIDTH: Record<Zoom, number> = { day: 44, week: 150, month: 420 };

interface TimelineTask {
    id: string;
    reference: number;
    title: string;
    status: string;
    priority: string;
    startDate: string | null;
    dueDate: string | null;
    assignees: { user: { id: string; name: string } }[];
    collaborators: { user: { id: string; name: string } }[];
    dependencies?: { dependsOn: { id: string } }[];
}

export function TimelinePage() {
    const qc = useQueryClient();
    const { role } = useAuth();
    const [zoom, setZoom] = useState<Zoom>('week');
    const [offset, setOffset] = useState(0);
    const [assigneeFilter, setAssigneeFilter] = useState('');

    const { data: tasks, isLoading, error } = useQuery({
        queryKey: ['timeline', assigneeFilter],
        queryFn: () =>
            apiClient.get<{ items: TimelineTask[] }>(
                `/tasks?pageSize=200&sort=dueDate&order=asc${assigneeFilter ? `&assigneeId=${assigneeFilter}` : ''}`,
            ),
    });

    const { data: milestones } = useQuery({
        queryKey: ['milestones'],
        queryFn: () => apiClient.get<{ id: string; name: string; dueDate: string }[]>('/milestones'),
    });

    const { data: members } = useQuery({
        queryKey: ['members'],
        queryFn: () => apiClient.get<{ user: { id: string; name: string } }[]>('/members'),
    });

    const reschedule = useMutation({
        mutationFn: ({ id, startDate, dueDate }: { id: string; startDate: string; dueDate: string }) =>
            apiClient.patch(`/tasks/${id}`, { startDate, dueDate }),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['timeline'] });
            void qc.invalidateQueries({ queryKey: ['board'] });
            void qc.invalidateQueries({ queryKey: ['dashboard'] });
        },
    });

    const columns = useMemo(() => {
        const width = COLUMN_WIDTH[zoom];
        const count = Math.ceil(window.innerWidth / width) + 4;
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const offsetDays = zoom === 'day' ? 7 : zoom === 'week' ? 28 : 180;
        start.setDate(start.getDate() + offset * offsetDays - 3);

        return Array.from({ length: count }, (_, i) => {
            const date = new Date(start.getTime() + i * (zoom === 'day' ? DAY : zoom === 'week' ? 7 * DAY : 30 * DAY));
            return { date, left: i * width, width };
        });
    }, [zoom, offset]);

    const rangeStart = columns[0]?.date ?? new Date();
    const rangeEnd = new Date(columns[columns.length - 1]?.date ?? new Date());
    rangeEnd.setTime(rangeEnd.getTime() + (zoom === 'day' ? DAY : zoom === 'week' ? 7 * DAY : 30 * DAY));

    const visible = (tasks?.items ?? []).filter((t) => {
        const due = t.dueDate ? new Date(t.dueDate) : null;
        const start = t.startDate ? new Date(t.startDate) : due;
        if (!due && !start) return false;
        return (start ?? due)! <= rangeEnd && (due ?? start)! >= rangeStart;
    });
    const personRows = visible.flatMap((task) => {
        const people = [...task.assignees, ...task.collaborators];
        const uniquePeople = [...new Map(people.map(({ user }) => [user.id, user])).values()];
        return uniquePeople.length
            ? uniquePeople.map((user) => ({ task, personId: user.id, personName: user.name }))
            : [{ task, personId: 'unassigned', personName: 'Unassigned' }];
    });

    const undated = (tasks?.items ?? []).filter((t) => !t.startDate && !t.dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const positionFor = (date: Date) => {
        const unit = zoom === 'day' ? DAY : zoom === 'week' ? 7 * DAY : 30 * DAY;
        const diff = (date.getTime() - rangeStart.getTime()) / unit;
        return diff * COLUMN_WIDTH[zoom];
    };

    if (isLoading) {
        return <div className="h-96 animate-pulse rounded-xl bg-gray-100" />;
    }
    if (error) return <div role="alert" className="rounded-xl border border-red-200 bg-white p-5 text-sm text-red-700">Could not load the timeline: {(error as Error).message}</div>;

    return (
        <div className="space-y-4">
            <header className="flex flex-wrap items-center gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">Timeline</h1>
                    <p className="text-sm text-slate-500">Plan tasks across time. Drag a bar to reschedule it.</p>
                </div>

                <div className="ml-auto flex flex-wrap items-center gap-2">
                    <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className={ctl}>
                        <option value="">Whole team</option>
                        {members?.map((m) => (
                            <option key={m.user.id} value={m.user.id}>{m.user.name}</option>
                        ))}
                    </select>

                    <div className="flex rounded-lg border border-slate-200 dark:border-slate-700">
                        {(['day', 'week', 'month'] as Zoom[]).map((z) => (
                            <button
                                key={z}
                                onClick={() => setZoom(z)}
                                className={`px-3 py-1.5 text-xs font-medium capitalize transition ${zoom === z ? 'bg-[#2563EB] text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                                    }`}
                            >
                                {z}
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center gap-1">
                        <button onClick={() => setOffset((o) => o - 1)} className={iconBtn} aria-label="Earlier"><ChevronLeft className="size-4" /></button>
                        <button onClick={() => setOffset(0)} className={ctl}>Today</button>
                        <button onClick={() => setOffset((o) => o + 1)} className={iconBtn} aria-label="Later"><ChevronRight className="size-4" /></button>
                    </div>
                </div>
            </header>
            {reschedule.error && <p role="alert" className="rounded-lg border border-red-200 bg-white p-3 text-sm text-red-700">Could not save the new dates: {(reschedule.error as Error).message}</p>}

            {/* Mobile fallback: an agenda list rather than an unreadable Gantt. */}
            <div className="lg:hidden">
                <h2 className="mb-2 text-sm font-semibold text-slate-500">Upcoming agenda</h2>
                <ul className="space-y-2">
                    {personRows
                        .filter(({ task }) => task.dueDate || task.startDate)
                        .sort((a, b) => +new Date(a.task.dueDate ?? a.task.startDate!) - +new Date(b.task.dueDate ?? b.task.startDate!))
                        .map(({ task, personId, personName }) => (
                            <li key={`${task.id}-${personId}`} className="rounded-lg border border-slate-200 bg-white p-3">
                                <div className="flex items-center justify-between gap-2">
                                    <Link to={`/tasks/${task.id}`} className="truncate text-sm font-medium hover:text-blue-700">{task.title}</Link>
                                    <span className="whitespace-nowrap text-xs text-slate-500">
                                        {new Date(task.dueDate ?? task.startDate!).toLocaleDateString()}
                                    </span>
                                </div>
                                <p className="mt-1 text-xs text-slate-500">{personName}</p>
                            </li>
                        ))}
                    {visible.length === 0 && (
                        <li className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400 dark:border-slate-700">
                            No scheduled tasks in this range.
                        </li>
                    )}
                </ul>
            </div>

            <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white lg:block">
                <div className="overflow-x-auto">
                    <div className="relative min-w-max">
                        {/* Header ruler */}
                        <div className="sticky top-0 z-20 flex border-b border-slate-200 bg-white">
                            <div className="w-64 shrink-0 border-r border-slate-200 p-2 text-xs font-medium text-slate-500 dark:border-slate-800">
                                Task
                            </div>
                            {columns.map((col, i) => (
                                <div
                                    key={i}
                                    style={{ width: col.width }}
                                    className="shrink-0 border-r border-slate-100 p-2 text-xs text-slate-500 dark:border-slate-800"
                                >
                                    {col.date.toLocaleDateString(undefined, {
                                        month: 'short',
                                        day: zoom === 'month' ? undefined : 'numeric',
                                    })}
                                </div>
                            ))}
                        </div>

                        {/* Rows */}
                        <div className="relative">
                            {/* Today marker */}
                            <div
                                className="pointer-events-none absolute inset-y-0 z-10 w-px bg-[#FCA840]"
                                style={{ left: 256 + positionFor(today) + COLUMN_WIDTH[zoom] / 2 }}
                            >
                                <span className="absolute -top-0 left-1 rounded bg-[#FCA840] px-1 text-[10px] font-semibold text-white">
                                    Today
                                </span>
                            </div>

                            {/* Milestones */}
                            {milestones?.map((m) => {
                                const date = new Date(m.dueDate);
                                if (date < rangeStart || date > rangeEnd) return null;
                                return (
                                    <div
                                        key={m.id}
                                        className="pointer-events-none absolute z-10"
                                        style={{ left: 256 + positionFor(date), top: 0 }}
                                    >
                                        <div className="rotate-45 border-l-8 border-t-8 border-l-[#FCA840] border-t-transparent" title={m.name} />
                                    </div>
                                );
                            })}

                            {personRows.map(({ task, personName, personId }) => (
                                <TimelineRow
                                    key={`${task.id}-${personId}`}
                                    task={task}
                                    personName={personName}
                                    zoom={zoom}
                                    left={positionFor(task.startDate ? new Date(task.startDate) : new Date(task.dueDate!))}
                                    width={
                                        task.startDate && task.dueDate
                                            ? Math.max(
                                                COLUMN_WIDTH[zoom] / 3,
                                                positionFor(new Date(task.dueDate)) -
                                                positionFor(new Date(task.startDate)) +
                                                (zoom === 'day' ? 32 : COLUMN_WIDTH[zoom] / 2),
                                            )
                                            : COLUMN_WIDTH[zoom] / 2
                                    }
                                    canDrag={role === 'LEADER'}
                                    onReschedule={(startDate, dueDate) => reschedule.mutate({ id: task.id, startDate, dueDate })}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {undated.length > 0 && (
                <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <h2 className="mb-2 text-sm font-semibold">
                        Tasks without dates <span className="font-normal text-slate-500">({undated.length})</span>
                    </h2>
                    <p className="mb-3 text-xs text-slate-500">
                        These tasks have no start date or deadline, so they cannot appear on the timeline. Open a task to
                        schedule it.
                    </p>
                    <ul className="flex flex-wrap gap-2">
                        {undated.map((t) => (
                            <li key={t.id} className="rounded-lg bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">
                                #{t.reference} {t.title}
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}

function TimelineRow({
    task,
    personName,
    zoom,
    left,
    width,
    canDrag,
    onReschedule,
}: {
    task: TimelineTask;
    personName: string;
    zoom: Zoom;
    left: number;
    width: number;
    canDrag: boolean;
    onReschedule: (start: string, due: string) => void;
}) {
    const dragRef = useRef<{ startX: number; originalStart: Date; originalDue: Date } | null>(null);
    const [preview, setPreview] = useState<{ dx: number; width: number } | null>(null);

    const priorityColor: Record<string, string> = {
        URGENT: 'bg-red-500',
        HIGH: 'bg-[#FCA840]',
        MEDIUM: 'bg-[#2563EB]',
        LOW: 'bg-slate-400',
    };

    const overdue =
        task.dueDate && task.status !== 'DONE' && new Date(task.dueDate).getTime() < Date.now();

    const onPointerDown = (e: React.PointerEvent) => {
        if (!canDrag || !task.startDate || !task.dueDate) return;
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        dragRef.current = {
            startX: e.clientX,
            originalStart: new Date(task.startDate),
            originalDue: new Date(task.dueDate),
        };
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (!dragRef.current) return;
        setPreview({ dx: e.clientX - dragRef.current.startX, width });
    };

    const onPointerUp = () => {
        const drag = dragRef.current;
        const p = preview;
        dragRef.current = null;
        setPreview(null);
        if (!drag || !p) return;

        const dayWidth = COLUMN_WIDTH[zoom] / (zoom === 'day' ? 1 : zoom === 'week' ? 7 : 30);
        const days = Math.round(p.dx / dayWidth);
        if (days === 0) return;

        const shift = days * DAY;
        const newStart = new Date(drag.originalStart.getTime() + shift);
        const newDue = new Date(drag.originalDue.getTime() + shift);
        onReschedule(newStart.toISOString(), newDue.toISOString());
    };

    return (
        <div className="flex border-b border-slate-100 dark:border-slate-800">
            <div className="w-64 shrink-0 border-r border-slate-200 p-2 dark:border-slate-800">
                <Link to={`/tasks/${task.id}`} className="block truncate text-sm font-medium hover:text-blue-700" title={task.title}>
                    <span className="text-slate-400">#{task.reference}</span> {task.title}
                </Link>
                <p className="truncate text-[11px] text-slate-500">
                    {personName}
                </p>
            </div>

            <div className="relative flex-1" style={{ height: 52 }}>
                <div
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    style={{
                        left: left + (preview?.dx ?? 0),
                        width: preview?.width ?? width,
                    }}
                    className={`absolute top-3 flex h-7 items-center gap-2 rounded-md px-2 text-xs font-medium text-white shadow-sm transition-shadow ${priorityColor[task.priority] ?? 'bg-slate-400'
                        } ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''} ${overdue ? 'ring-2 ring-red-400 ring-offset-1' : ''
                        }`}
                    title={`${task.title}${task.dueDate ? ` · due ${new Date(task.dueDate).toLocaleDateString()}` : ''}`}
                >
                    {(task.dependencies?.length ?? 0) > 0 && <span className="text-[10px] opacity-80">⇢</span>}
                    <span className="truncate">{task.title}</span>
                </div>
            </div>
        </div>
    );
}

const ctl =
    'rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800';
const iconBtn =
    'rounded-lg border border-slate-200 p-1.5 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800';
