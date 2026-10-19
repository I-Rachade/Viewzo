import { IsUrl, MaxLength } from 'class-validator';

export class SubmitPostDto {
  // Link to the published post (for WhatsApp Statut, the capture flow comes later).
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(500)
  postUrl!: string;
}
