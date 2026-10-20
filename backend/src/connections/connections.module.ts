import { Module } from '@nestjs/common';
import {
  ConnectionCallbackController,
  ConnectionsController,
} from './connections.controller';
import { ConnectionsService } from './connections.service';

@Module({
  controllers: [ConnectionsController, ConnectionCallbackController],
  providers: [ConnectionsService],
  exports: [ConnectionsService],
})
export class ConnectionsModule {}
