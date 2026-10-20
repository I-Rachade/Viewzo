import { Global, Module } from '@nestjs/common';
import { StaffGuard } from '../auth/staff.guard';
import { ModuleEnabledGuard } from './module-enabled.guard';
import {
  ModulesController,
  StaffModulesController,
} from './modules.controller';
import { ModulesService } from './modules.service';

// Global: every optional module checks its switch here.
@Global()
@Module({
  controllers: [ModulesController, StaffModulesController],
  providers: [ModulesService, ModuleEnabledGuard, StaffGuard],
  exports: [ModulesService, ModuleEnabledGuard],
})
export class ModulesModule {}
