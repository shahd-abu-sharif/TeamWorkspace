import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentMembership, Roles } from '../common/decorators';
import type { Membership } from '../common/decorators';
import { ZodBody } from '../common/zod-validation.pipe';
import { TeamsService } from './teams.service';
import {
    AddTeamMemberSchema,
    CreateTeamSchema,
    UpdateTeamSchema,
    type AddTeamMemberDto,
    type CreateTeamDto,
    type UpdateTeamDto,
} from './dto';

/**
 * Teams are readable by every workspace member (they drive the epic/task
 * assignee pickers). Structural changes are admin-only; membership is
 * admin-or-team-lead and enforced inside the service.
 */
@Controller('teams')
export class TeamsController {
    constructor(private readonly teams: TeamsService) { }

    @Get()
    list(@CurrentMembership() m: Membership) {
        return this.teams.list(m);
    }

    @Get(':id')
    findOne(@CurrentMembership() m: Membership, @Param('id') id: string) {
        return this.teams.findOne(m, id);
    }

    @Get(':id/workload')
    workload(@CurrentMembership() m: Membership, @Param('id') id: string) {
        return this.teams.workload(m, id);
    }

    @Post()
    @Roles('LEADER')
    create(@CurrentMembership() m: Membership, @Body(new ZodBody(CreateTeamSchema)) dto: CreateTeamDto) {
        return this.teams.create(m, dto);
    }

    @Patch(':id')
    @Roles('LEADER')
    update(
        @CurrentMembership() m: Membership,
        @Param('id') id: string,
        @Body(new ZodBody(UpdateTeamSchema)) dto: UpdateTeamDto,
    ) {
        return this.teams.update(m, id, dto);
    }

    @Delete(':id')
    @Roles('LEADER')
    remove(@CurrentMembership() m: Membership, @Param('id') id: string) {
        return this.teams.remove(m, id);
    }

    @Post(':id/members')
    addMember(
        @CurrentMembership() m: Membership,
        @Param('id') id: string,
        @Body(new ZodBody(AddTeamMemberSchema)) dto: AddTeamMemberDto,
    ) {
        return this.teams.addMember(m, id, dto);
    }

    @Delete(':id/members/:userId')
    removeMember(
        @CurrentMembership() m: Membership,
        @Param('id') id: string,
        @Param('userId') userId: string,
    ) {
        return this.teams.removeMember(m, id, userId);
    }
}
