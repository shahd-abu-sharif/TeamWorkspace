// apps/api/src/files/files.controller.ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { FilesService } from './files.service';

@Controller('files')
export class FilesController {
  constructor(private files: FilesService) { }

  @Post('upload-url')
  create(@Body() body: { fileName: string; mimeType: string }) {
    return this.files.createUploadUrl(body.fileName, body.mimeType);
  }

  @Get('download-url/*key')
  download(@Param('key') key: string | string[]) {
    return this.files.createDownloadUrl(Array.isArray(key) ? key.join('/') : key);
  }
}
