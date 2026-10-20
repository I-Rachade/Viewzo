import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  ParseEnumPipe,
  Query,
  Redirect,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialNetwork } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/jwt.strategy';
import { ConnectionsService } from './connections.service';

const networkPipe = new ParseEnumPipe(SocialNetwork);

@Controller('me/connections')
@UseGuards(JwtAuthGuard)
export class ConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}

  @Get()
  list(@Req() req: { user: AuthUser }) {
    return this.connections.list(req.user.userId);
  }

  // The app or the website opens this URL in the browser.
  @Get(':network/start')
  start(
    @Req() req: { user: AuthUser },
    @Param('network', networkPipe) network: SocialNetwork,
  ) {
    return this.connections.startUrl(req.user.userId, network);
  }

  @Delete(':network')
  @HttpCode(204)
  disconnect(
    @Req() req: { user: AuthUser },
    @Param('network', networkPipe) network: SocialNetwork,
  ) {
    return this.connections.disconnect(req.user.userId, network);
  }
}

// Where the platforms send the creator back after logging in.
@Controller('connections')
export class ConnectionCallbackController {
  private readonly logger = new Logger(ConnectionCallbackController.name);

  constructor(
    private readonly connections: ConnectionsService,
    private readonly config: ConfigService,
  ) {}

  @Get(':network/callback')
  @Redirect()
  async callback(
    @Param('network') raw: string,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    const network = raw.toUpperCase() as SocialNetwork;
    const web = this.config
      .get<string>('WEB_ORIGIN', 'http://localhost:3000')
      .split(',')[0];
    const back = (status: string, reason?: string) => ({
      url: `${web}/connexions?${new URLSearchParams({
        network,
        status,
        ...(reason ? { reason } : {}),
      })}`,
    });
    if (!Object.values(SocialNetwork).includes(network) || error || !code) {
      return back('cancelled');
    }
    try {
      await this.connections.callback(network, code, state ?? '');
      return back('ok');
    } catch (e) {
      this.logger.warn(`${network} callback: ${(e as Error).message}`);
      // Our own refusals (wrong account) are worth showing to the creator.
      return back(
        'error',
        e instanceof BadRequestException ? e.message : undefined,
      );
    }
  }
}
