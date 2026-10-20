import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ModuleKey } from './modules';
import { ModulesService } from './modules.service';

const MODULE_KEY = 'platformModule';

/** Endpoints of an optional module; they answer 404 while it is off. */
export const RequiresModule = (key: ModuleKey) => SetMetadata(MODULE_KEY, key);

@Injectable()
export class ModuleEnabledGuard implements CanActivate {
  constructor(
    private readonly modules: ModulesService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext) {
    const key = this.reflector.getAllAndOverride<ModuleKey | undefined>(
      MODULE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (key && !(await this.modules.isEnabled(key))) {
      throw new NotFoundException();
    }
    return true;
  }
}
