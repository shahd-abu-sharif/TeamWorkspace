// apps/web/src/pages/Kanban.tsx
import {
    DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
    closestCorners, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { useDroppable } from '@dnd-kit/core';
import { useDraggable } from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useTranslation } from 'react-i18next';

const COLUMNS = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE'] as const;
type Column = (typeof COLUMNS)[number];

interface TaskCard {
    id: string;
    reference: number;
    title: string;
    status: Column;
    startedAt?: string | null;
    priority: string;
    dueDate: string | null;
    workstream?: { name: string; color: string } | null;
    assignees: { user: { id: string; name: string; avatarUrl?: string | null } }[];
    tags: { tag: { id: string; name: string } }[];
}

const PRIORITY_STYLE: Record<string, string> = {
    URGENT: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
    HIGH: 'bg-[#FCA840]/20 text-[#b45309] dark:text-[#FCA840]',
    MEDIUM: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
    LOW: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};

export function KanbanPage() {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const { role } = useAuth();
    const canMoveTasks = role === 'LEADER' || role === 'MEMBER';
    const [active, setActive] = useState<TaskCard | null>(null);

    const { data, isLoading } = useQuery({
        queryKey: ['board'],
        queryFn: () => apiClient.get<Record<Column, TaskCard[]>>('/tasks/board'),
    });

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

    const move = useMutation({
        mutationFn: ({ id, status }: { id: string; status: Column }) =>
            apiClient.patch(`/tasks/${id}/status`, { status }),

        // Optimistic update: the board responds instantly, then reconciles.
        onMutate: async ({ id, status }) => {
            await qc.cancelQueries({ queryKey: ['board'] });
            const previous = qc.getQueryData<Record<Column, TaskCard[]>>(['board']);

            qc.setQueryData<Record<Column, TaskCard[]>>(['board'], (old) => {
                if (!old) return old;
                const next = { ...old };
                let moved: TaskCard | undefined;
                for (const col of COLUMNS) {
                    const found = next[col]?.find((t) => t.id === id);
                    if (found) {
                        moved = { ...found, status };
                        next[col] = next[col].filter((t) => t.id !== id);
                        break;
                    }
                }
                if (moved) next[status] = [...(next[status] ?? []), moved];
                return next;
            });

            return { previous };
        },
        onError: (_err, _vars, ctx) => {
            if (ctx?.previous) qc.setQueryData(['board'], ctx.previous);
        },
        onSettled: () => {
            void qc.invalidateQueries({ queryKey: ['board'] });
            void qc.invalidateQueries({ queryKey: ['dashboard'] });
        },
    });

    const onDragEnd = (event: DragEndEvent) => {
        setActive(null);
        if (!canMoveTasks) return;
        const { active: dragged, over } = event;
        if (!over) return;
        const targetStatus = over.id as Column;
        const task = COLUMNS.flatMap((c) => data?.[c] ?? []).find((t) => t.id === dragged.id);
        if (!task || task.status === targetStatus) return;
        const hasStarted = Boolean(task.startedAt || ['IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE'].includes(task.status));
        if (hasStarted && (targetStatus === 'BACKLOG' || targetStatus === 'TODO')) return;
        move.mutate({ id: task.id, status: targetStatus });
    };

    if (isLoading) return <BoardSkeleton />;

    return (
        <div className="space-y-4">
            <header>
                <h1 className="text-2xl font-semibold">{t('kanban.title')}</h1>
                <p className="text-sm text-slate-500">
                    {t('kanban.subtitle')}
                </p>
            </header>

            <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragStart={(e: DragStartEvent) => {
                    const task = COLUMNS.flatMap((c) => data?.[c] ?? []).find((t) => t.id === e.active.id);
                    setActive(task ?? null);
                }}
                onDragEnd={onDragEnd}
                onDragCancel={() => setActive(null)}
            >
                <div className="flex gap-4 overflow-x-auto pb-4">
                    {COLUMNS.map((column) => (
                        <Column
                            key={column}
                            id={column}
                            count={data?.[column]?.length ?? 0}
                            canDrop={canMoveTasks}
                            blocked={Boolean(active?.startedAt || (active && ['IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE'].includes(active.status))) && (column === 'BACKLOG' || column === 'TODO')}
                        >
                            {data?.[column]?.map((task) => <Card key={task.id} task={task} canDrag={canMoveTasks} />)}
                            {(data?.[column]?.length ?? 0) === 0 && (
                                    <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400 dark:border-slate-700">
                                        {t('kanban.empty')}
                                </p>
                            )}
                        </Column>
                    ))}
                </div>

                <DragOverlay>
                    {active && canMoveTasks ? <Card task={active} overlay canDrag={canMoveTasks} /> : null}
                </DragOverlay>
            </DndContext>

            {role === 'MEMBER' && (
                <p className="text-xs text-slate-500">
                    {t('kanban.memberNote')}
                </p>
            )}
        </div>
    );
}

function Column({ id, count, children, canDrop, blocked }: { id: Column; count: number; children: React.ReactNode; canDrop: boolean; blocked: boolean }) {
    const { t } = useTranslation();
    const { setNodeRef, isOver } = useDroppable({ id, disabled: !canDrop });
    return (
        <div
            ref={setNodeRef}
            className={`flex w-72 shrink-0 flex-col rounded-xl border p-3 transition ${blocked ? (isOver ? 'border-red-300 bg-red-50/70' : 'border-slate-200 bg-slate-100/70 opacity-70 dark:border-slate-800 dark:bg-slate-900/60') : isOver ? 'border-[#2563EB] bg-[#2563EB]/5' : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60'
                }`}
        >
            <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">{t(`status.${id}`)}</h2>
                <span className="rounded-full bg-slate-200 px-2 text-xs font-medium dark:bg-slate-800">{count}</span>
            </div>
            {blocked && <p className="mb-2 text-[11px] text-red-600">{t('kanban.startedTaskDropBlocked')}</p>}
            <div className="flex flex-1 flex-col gap-2">{children}</div>
        </div>
    );
}

function Card({ task, overlay, canDrag }: { task: TaskCard; overlay?: boolean; canDrag: boolean }) {
    const { t } = useTranslation();
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: !canDrag });

    const overdue =
        task.dueDate && task.status !== 'DONE' && new Date(task.dueDate).getTime() < Date.now();

    return (
        <article
            ref={setNodeRef}
            {...listeners}
            {...attributes}
            className={`${canDrag ? 'cursor-grab active:cursor-grabbing' : ''} rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition dark:border-slate-700 dark:bg-slate-800 ${isDragging && !overlay ? 'opacity-40' : ''
                } ${overlay ? 'rotate-2 shadow-xl' : 'hover:shadow-md'}`}
        >
            <div className="mb-2 flex items-start justify-between gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${PRIORITY_STYLE[task.priority]}`}>
                    {t(`priority.${task.priority}`)}
                </span>
                <span className="text-[10px] text-slate-400">#{task.reference}</span>
            </div>

            <p className="line-clamp-2 text-sm font-medium">{task.title}</p>

            {task.workstream && (
                <span className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-500">
                    <span className="size-2 rounded-full" style={{ background: task.workstream.color }} />
                    {task.workstream.name}
                </span>
            )}

            <div className="mt-3 flex items-center justify-between">
                <div className="flex -space-x-2">
                    {task.assignees.slice(0, 3).map((a) => (
                        <span
                            key={a.user.id}
                            title={a.user.name}
                            className="grid size-6 place-items-center rounded-full border-2 border-white bg-[#2563EB] text-[10px] font-semibold text-white dark:border-slate-800"
                        >
                            {a.user.name.charAt(0).toUpperCase()}
                        </span>
                    ))}
                    {task.assignees.length > 3 && (
                        <span className="grid size-6 place-items-center rounded-full border-2 border-white bg-slate-300 text-[10px] dark:border-slate-800">
                            +{task.assignees.length - 3}
                        </span>
                    )}
                </div>

                {task.dueDate && (
                    <span className={`text-[11px] font-medium ${overdue ? 'text-red-600 dark:text-red-400' : 'text-slate-500'}`}>
                        {new Date(task.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                )}
            </div>
        </article>
    );
}

function BoardSkeleton() {
    return (
        <div className="flex gap-4 overflow-hidden">
            {COLUMNS.map((c) => (
                <div key={c} className="w-72 shrink-0 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                    <div className="h-4 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="h-24 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
                    ))}
                </div>
            ))}
        </div>
    );
}
