import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CampaignFilesController } from './campaign-files.controller';
import { CampaignFilesService } from './campaign-files.service';
import { DiskFileStorage, FILE_STORAGE } from './file-storage';

@Global()
@Module({
  controllers: [CampaignFilesController],
  providers: [
    CampaignFilesService,
    {
      provide: FILE_STORAGE,
      useFactory: (config: ConfigService) => new DiskFileStorage(config),
      inject: [ConfigService],
    },
  ],
  exports: [CampaignFilesService],
})
export class FilesModule {}
