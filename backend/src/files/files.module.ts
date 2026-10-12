// apps/api/src/files/files.module.ts
import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({ controllers: [FilesController], providers: [FilesService], exports: [FilesService] })
export class FilesModule { }