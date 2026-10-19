import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { CreatorTaskType, ProfileType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SkillsDto } from './dto/skills.dto';

@Injectable()
export class SkillsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string) {
    return this.prisma.creatorSkills.findUnique({
      where: { userId },
      omit: { userId: true },
    });
  }

  async save(userId: string, dto: SkillsDto) {
    const creator = await this.prisma.userProfile.findUnique({
      where: { userId_type: { userId, type: ProfileType.CREATOR } },
    });
    if (!creator) {
      throw new ForbiddenException("Active d'abord le profil Créateur");
    }

    const data = {
      ...dto,
      taskTypes: [...new Set(dto.taskTypes)],
      specialties: [...new Set(dto.specialties ?? [])],
      exampleLinks: dto.exampleLinks ?? [],
      cities: dto.cities ?? [],
    };
    if (data.taskTypes.includes(CreatorTaskType.CREATE_ORIGINAL_VIDEO)) {
      if (data.specialties.length === 0) {
        throw new BadRequestException('Choisis au moins une spécialité');
      }
      if (data.exampleLinks.length < 3) {
        throw new BadRequestException('Ajoute 3 à 5 liens de vidéos');
      }
    }

    await this.prisma.creatorSkills.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return this.get(userId);
  }
}
