import { ForbiddenException, SetMetadata } from '@nestjs/common';
import { StaffRole } from '@prisma/client';

/** The team member behind a back-office request, set by StaffGuard. */
export interface StaffActor {
  userId: string;
  role: StaffRole;
  // Empty: every country.
  countries: string[];
  ip?: string;
}

export interface StaffRequest {
  user: { userId: string };
  staff: StaffActor;
}

export const STAFF_ROLES_KEY = 'staffRoles';

/** Roles allowed on a back-office endpoint; without it every role may read. */
export const StaffRoles = (...roles: StaffRole[]) =>
  SetMetadata(STAFF_ROLES_KEY, roles);

// Who may take which decision, from the specification's roles table.
export const MODERATION: StaffRole[] = [
  StaffRole.SUPER_ADMIN,
  StaffRole.COUNTRY_MANAGER,
  StaffRole.MODERATOR,
];
export const FINANCE: StaffRole[] = [StaffRole.SUPER_ADMIN, StaffRole.FINANCE];

/** Countries the member is limited to, or null for all of them. */
export function countryScope(actor: StaffActor): string[] | null {
  if (actor.role === StaffRole.SUPER_ADMIN || actor.countries.length === 0) {
    return null;
  }
  return actor.countries;
}

/** Throws unless the member works on (one of) the given countries. */
export function assertCountry(actor: StaffActor, country: string | string[]) {
  const scope = countryScope(actor);
  if (!scope) return;
  const wanted = Array.isArray(country) ? country : [country];
  if (!wanted.some((c) => scope.includes(c))) {
    throw new ForbiddenException('Hors de tes pays');
  }
}

/** No one decides on their own account, campaign, post or money. */
export function assertNotSelf(actor: StaffActor, ownerId: string) {
  if (actor.userId === ownerId) {
    throw new ForbiddenException(
      'Tu ne peux pas décider sur ton propre compte : demande à un collègue',
    );
  }
}
