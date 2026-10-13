// // apps/api/prisma/seed.ts
// import 'dotenv/config';
// import { PrismaClient } from '@prisma/client';
// import { PrismaPg } from '@prisma/adapter-pg';
// import * as argon2 from 'argon2';

// const connectionString = process.env.DATABASE_URL;
// if (!connectionString) throw new Error('DATABASE_URL must be configured before seeding');

// const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// async function main() {
//     const passwordHash = await argon2.hash('ChangeMe12345', { type: argon2.argon2id });

//     const leader = await prisma.user.upsert({
//         where: { email: 'leader@tadreeby.dev' },
//         update: {},
//         create: {
//             email: 'leader@tadreeby.dev',
//             name: 'Shahd abu sharif',
//             passwordHash,
//             jobTitle: 'Team Lead | Backend Developer',
//         },
//     });

//     const workspace = await prisma.workspace.upsert({
//         where: { slug: 'tadreeby' },
//         update: {},
//         create: { name: 'Tadreeby', slug: 'tadreeby', ownerId: leader.id },
//     });

//     await prisma.workspaceMember.upsert({
//         where: { workspaceId_userId: { workspaceId: workspace.id, userId: leader.id } },
//         update: { role: 'LEADER' },
//         create: { workspaceId: workspace.id, userId: leader.id, role: 'LEADER' },
//     });

//     await prisma.notificationPreference.upsert({
//         where: { userId: leader.id },
//         update: {},
//         create: { userId: leader.id },
//     });

//     const workstreams = ['Backend', 'Frontend', 'Mobile', 'UI/UX', 'QA'];
//     for (const name of workstreams) {
//         await prisma.workstream.upsert({
//             where: { workspaceId_name: { workspaceId: workspace.id, name } },
//             update: {},
//             create: { workspaceId: workspace.id, name },
//         });
//     }

//     const backend = await prisma.workstream.findFirstOrThrow({
//         where: { workspaceId: workspace.id, name: 'Backend' },
//     });

//     // Seed only when the workspace is empty, so re-running is safe.
//     if ((await prisma.task.count({ where: { workspaceId: workspace.id } })) === 0) {
//         await prisma.task.createMany({
//             data: [
//                 {
//                     workspaceId: workspace.id,
//                     reference: 1,
//                     title: 'Design the internship matching algorithm',
//                     description: 'Score student preferences against company requirements and produce ranked matches.',
//                     createdById: leader.id,
//                     workstreamId: backend.id,
//                     priority: 'HIGH',
//                     status: 'IN_PROGRESS',
//                     startDate: new Date(),
//                     dueDate: new Date(Date.now() + 5 * 86_400_000),
//                     estimatedHrs: 16,
//                 },
//                 {
//                     workspaceId: workspace.id,
//                     reference: 2,
//                     title: 'Build the student onboarding flow',
//                     createdById: leader.id,
//                     priority: 'MEDIUM',
//                     status: 'TODO',
//                     dueDate: new Date(Date.now() + 10 * 86_400_000),
//                     estimatedHrs: 24,
//                 },
//             ],
//         });
//     }

//     console.log('Seed complete. Sign in with leader@tadreeby.dev / ChangeMe12345');
// }

// main()
//     .catch((e) => {
//         console.error(e);
//         process.exit(1);
//     })
//     .finally(() => prisma.$disconnect());


// apps/api/prisma/seed.ts
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('DATABASE_URL must be configured before seeding');
}

const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
});

async function main() {
    const passwordHash = await argon2.hash('ChangeMe12345', {
        type: argon2.argon2id,
    });

    // ---- Leader account ----
    const leader = await prisma.user.upsert({
        where: { email: 'leader@tadreeby.dev' },
        update: {},
        create: {
            email: 'leader@tadreeby.dev',
            name: 'Shahd Abu Sharif',
            passwordHash,
            jobTitle: 'Team Lead | Backend Developer',
        },
    });

    // ---- Workspace ----
    const workspace = await prisma.workspace.upsert({
        where: { slug: 'tadreeby' },
        update: {},
        create: {
            name: 'Tadreeby',
            slug: 'tadreeby',
            ownerId: leader.id,
        },
    });

    // ---- Leader membership ----
    await prisma.workspaceMember.upsert({
        where: {
            workspaceId_userId: {
                workspaceId: workspace.id,
                userId: leader.id,
            },
        },
        update: { role: 'LEADER' },
        create: {
            workspaceId: workspace.id,
            userId: leader.id,
            role: 'LEADER',
        },
    });

    // ---- Notification preferences ----
    await prisma.notificationPreference.upsert({
        where: { userId: leader.id },
        update: {},
        create: { userId: leader.id },
    });

    // ---- Workstreams (empty categories — tasks come from your import) ----
    const workstreams = [
        { name: 'Backend', color: '#2563EB' },
        { name: 'Frontend', color: '#F97316' },
        { name: 'Mobile', color: '#10B981' },
        { name: 'UX/UI', color: '#8B5CF6' },
        { name: 'QA', color: '#EF4444' },
        { name: 'Decisions', color: '#F59E0B' },
    ];

    for (const ws of workstreams) {
        await prisma.workstream.upsert({
            where: {
                workspaceId_name: {
                    workspaceId: workspace.id,
                    name: ws.name,
                },
            },
            update: { color: ws.color },
            create: {
                workspaceId: workspace.id,
                name: ws.name,
                color: ws.color,
            },
        });
    }

    console.log('');
    console.log('═══════════════════════════════════════════════');
    console.log('  Seed complete');
    console.log('═══════════════════════════════════════════════');
    console.log('');
    console.log('  Sign in with:');
    console.log('    Email:    leader@tadreeby.dev');
    console.log('    Password: ChangeMe12345');
    console.log('');
    console.log('  Workspace:  Tadreeby');
    console.log('  Workstreams: Backend, Frontend, Mobile, UI/UX, QA, Decisions');
    console.log('  Tasks:      (empty — import them from the Excel file)');
    console.log('');
    console.log('  ⚠️  Change the password after first login.');
    console.log('');
}

main()
    .catch((e) => {
        console.error('Seed failed:', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
