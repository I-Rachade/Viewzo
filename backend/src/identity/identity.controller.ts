import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { IdentityCheckStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/jwt.strategy';
import { PhoneVerifiedGuard } from '../auth/phone-verified.guard';
import { MODERATION, StaffRoles } from '../auth/staff';
import type { StaffRequest } from '../auth/staff';
import { StaffGuard } from '../auth/staff.guard';
import { sniffFile } from '../files/file-types';
import { ReviewIdentityDto } from './dto/review-identity.dto';
import type { IdentityImage } from './identity-provider';
import { IdentityService } from './identity.service';

const MAX_IDENTITY_IMAGE_BYTES = 10 * 1024 * 1024;

// Identity verification that opens level 2 (all tasks, withdrawals).
@Controller('me/identity')
@UseGuards(JwtAuthGuard)
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Get()
  status(@Req() req: { user: AuthUser }) {
    return this.identity.status(req.user.userId);
  }

  // The document's front (and back) and a selfie, as JPEG, PNG or WebP.
  @Post()
  @UseGuards(PhoneVerifiedGuard)
  @HttpCode(200)
  @UseInterceptors(
    // Without a destination, multer keeps the photos in memory: they go to
    // the provider and are never written to disk.
    FileFieldsInterceptor(
      [
        { name: 'front', maxCount: 1 },
        { name: 'back', maxCount: 1 },
        { name: 'selfie', maxCount: 1 },
      ],
      { limits: { fileSize: MAX_IDENTITY_IMAGE_BYTES, files: 3 } },
    ),
  )
  submit(
    @Req() req: { user: AuthUser },
    @UploadedFiles()
    files: Partial<Record<'front' | 'back' | 'selfie', UploadedPhoto[]>>,
  ) {
    const front = photo(files?.front?.[0], 'le recto de ta pièce');
    const selfie = photo(files?.selfie?.[0], 'ton selfie');
    const back = files?.back?.[0]
      ? photo(files.back[0], 'le verso de ta pièce')
      : undefined;
    return this.identity.submit(req.user.userId, { front, back, selfie });
  }
}

interface UploadedPhoto {
  buffer: Buffer;
  size: number;
}

/** A photo whose type is read from its bytes, never from the client. */
function photo(file: UploadedPhoto | undefined, what: string): IdentityImage {
  if (!file?.buffer?.length) {
    throw new BadRequestException(`Ajoute ${what}`);
  }
  const type = sniffFile(file.buffer);
  if (type?.kind !== 'IMAGE') {
    throw new BadRequestException(
      `Photo non reconnue pour ${what} : envoie une image JPEG ou PNG`,
    );
  }
  return { buffer: file.buffer, mimeType: type.mime };
}

@Controller('staff/identity')
@UseGuards(JwtAuthGuard, StaffGuard)
export class StaffIdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Get()
  queue(
    @Req() req: StaffRequest,
    @Query('status', new ParseEnumPipe(IdentityCheckStatus, { optional: true }))
    status?: IdentityCheckStatus,
  ) {
    return this.identity.queue(req.staff, status);
  }

  @Post(':id/review')
  @StaffRoles(...MODERATION)
  @HttpCode(200)
  review(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewIdentityDto,
  ) {
    return this.identity.review(req.staff, id, dto.decision, dto.reason);
  }
}
