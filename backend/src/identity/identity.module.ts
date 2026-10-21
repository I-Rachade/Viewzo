import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StaffGuard } from '../auth/staff.guard';
import { PhoneVerifiedGuard } from '../auth/phone-verified.guard';
import { DiditIdentityProvider } from './didit-identity.provider';
import { IDENTITY_PROVIDER } from './identity-provider';
import {
  IdentityController,
  StaffIdentityController,
} from './identity.controller';
import { IdentityService } from './identity.service';
import { LocalIdentityProvider } from './local-identity.provider';

@Global()
@Module({
  controllers: [IdentityController, StaffIdentityController],
  providers: [
    IdentityService,
    StaffGuard,
    PhoneVerifiedGuard,
    {
      provide: IDENTITY_PROVIDER,
      inject: [ConfigService],
      // didit in production; local (team review with sample data) elsewhere.
      useFactory: (config: ConfigService) =>
        config.get('IDENTITY_PROVIDER') === 'didit'
          ? new DiditIdentityProvider(config)
          : new LocalIdentityProvider(),
    },
  ],
  exports: [IdentityService],
})
export class IdentityModule {}
