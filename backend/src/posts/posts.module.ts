import { Module } from '@nestjs/common';
import { StaffGuard } from '../auth/staff.guard';
import { ConnectionsModule } from '../connections/connections.module';
import { WalletModule } from '../wallet/wallet.module';
import { FilesController, PostsController } from './posts.controller';
import { PostsScheduler, VIEW_COUNTER_LIST } from './posts.scheduler';
import { ProofStorage } from './proof-storage';
import { ProofsService } from './proofs.service';
import { ReportService } from './report.service';
import { StaffPostsController } from './staff-posts.controller';
import { StaffPostsService } from './staff-posts.service';
import { VIEW_COUNTERS, ViewCounter } from './view-counters';

// Proofs of published posts, their review by the team, and reports.
@Module({
  imports: [WalletModule, ConnectionsModule],
  controllers: [PostsController, FilesController, StaffPostsController],
  providers: [
    ProofStorage,
    ProofsService,
    StaffPostsService,
    ReportService,
    PostsScheduler,
    ...VIEW_COUNTERS,
    {
      provide: VIEW_COUNTER_LIST,
      useFactory: (...counters: ViewCounter[]) => counters,
      inject: VIEW_COUNTERS,
    },
    StaffGuard,
  ],
  exports: [ProofsService],
})
export class PostsModule {}
