// apps/api/src/import/import.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentMembership, Roles } from '../common/decorators';
import type { Membership } from '../common/decorators';
import { ImportService } from './import.service';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = /\.(xlsx|xls|csv)$/i;

@Controller('import')
@Roles('LEADER')
export class ImportController {
  constructor(private imports: ImportService) { }

  @Post('parse')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async parse(@UploadedFile() file: Express.Multer.File, @Body('sheetName') sheetName?: string) {
    if (!file) throw new BadRequestException('No file was uploaded');
    if (!ALLOWED.test(file.originalname)) {
      throw new BadRequestException('Only .xlsx, .xls and .csv files are supported');
    }
    const parsed = await this.imports.parse(file.buffer, file.originalname, sheetName);
    return {
      ...parsed,
      suggestedMapping: this.imports.suggestMapping(parsed.headers),
    };
  }

  @Post('draft')
  draft(@CurrentMembership() m: Membership, @Body() body: any) {
    return this.imports.buildDraft(m, body);
  }

  @Post('commit')
  commit(@CurrentMembership() m: Membership, @Body() body: any) {
    return this.imports.commit(m, body);
  }

  @Get('jobs')
  jobs(@CurrentMembership() m: Membership) {
    return this.imports.listJobs(m);
  }

  @Get('jobs/:id/errors')
  errors(@CurrentMembership() m: Membership, @Param('id') id: string) {
    return this.imports.jobErrors(m, id);
  }

  @Get('distribution')
  distribution(@CurrentMembership() m: Membership) {
    return this.imports.suggestDistribution(m);
  }

  @Post('distribution/apply')
  applyDistribution(
    @CurrentMembership() m: Membership,
    @Body() body: { changes: { taskId: string; toUserId: string }[] },
  ) {
    return this.imports.applyDistribution(m, body.changes ?? []);
  }
}
