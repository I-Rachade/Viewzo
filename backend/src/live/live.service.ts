import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LiveLeadStatus,
  LiveSaleStatus,
  Prisma,
  ProfileType,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import {
  assertCountry,
  assertNotSelf,
  countryScope,
  type StaffActor,
} from '../auth/staff';
import { PrismaService } from '../prisma/prisma.service';
import {
  CartItem,
  cartTotal,
  guessQuantity,
  matchProduct,
  newLeadCode,
  toItems,
} from './cart';
import type { CreateLiveDto, UpdateLiveDto } from './dto/live.dto';
import type { ManualLeadDto } from './dto/lead.dto';
import type { ProductDto, UpdateProductDto } from './dto/product.dto';
import {
  CatalogEntry,
  CustomerContext,
  IntentResult,
  isInterested,
  LiveCommentIn,
  maskPhones,
} from './intent';

const PRODUCT_SELECT = {
  id: true,
  name: true,
  price: true,
  stock: true,
  active: true,
} as const;

const LIVE_SELECT = {
  id: true,
  title: true,
  tiktokUsername: true,
  scheduledAt: true,
  demo: true,
  productIds: true,
  status: true,
  startedAt: true,
  endedAt: true,
  viewers: true,
  sourceState: true,
  sourceMessage: true,
  cancelReason: true,
  createdAt: true,
} as const;

const LEAD_SELECT = {
  id: true,
  code: true,
  tiktokUser: true,
  nickname: true,
  intent: true,
  items: true,
  total: true,
  reply: true,
  status: true,
  phoneSeen: true,
  firstAt: true,
  lastAt: true,
} as const;

// Statuses a seller may set by hand from the live screen.
const SELLER_LEAD_STATUSES: LiveLeadStatus[] = [
  LiveLeadStatus.NEW,
  LiveLeadStatus.CONTACTED,
  LiveLeadStatus.PAID,
  LiveLeadStatus.DELIVERED,
  LiveLeadStatus.CANCELLED,
];

const isUniqueError = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

const asItems = (json: Prisma.JsonValue): CartItem[] =>
  Array.isArray(json) ? (json as unknown as CartItem[]) : [];

// Sellers' products, lives, and the customers the AI finds in the comments.
@Injectable()
export class LiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Selling in a live uses the advertiser profile. */
  async assertSeller(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId_type: { userId, type: ProfileType.ADVERTISER } },
      select: { id: true },
    });
    if (!profile) {
      throw new ForbiddenException("Active d'abord le profil Annonceur");
    }
  }

  // --- Products ------------------------------------------------------------

  listProducts(sellerId: string) {
    return this.prisma.liveProduct.findMany({
      where: { sellerId },
      select: PRODUCT_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async createProduct(sellerId: string, dto: ProductDto) {
    await this.assertSeller(sellerId);
    return this.prisma.liveProduct.create({
      data: {
        sellerId,
        name: dto.name.trim(),
        price: dto.price,
        stock: dto.stock ?? null,
        active: dto.active ?? true,
      },
      select: PRODUCT_SELECT,
    });
  }

  async updateProduct(sellerId: string, id: string, dto: UpdateProductDto) {
    await this.ownProduct(sellerId, id);
    return this.prisma.liveProduct.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        price: dto.price,
        stock: dto.stock,
        active: dto.active,
      },
      select: PRODUCT_SELECT,
    });
  }

  async deleteProduct(sellerId: string, id: string) {
    await this.ownProduct(sellerId, id);
    await this.prisma.liveProduct.delete({ where: { id } });
  }

  private async ownProduct(sellerId: string, id: string) {
    const product = await this.prisma.liveProduct.findFirst({
      where: { id, sellerId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Produit introuvable');
  }

  // --- Lives ---------------------------------------------------------------

  async createLive(sellerId: string, dto: CreateLiveDto) {
    await this.assertSeller(sellerId);
    const productIds = await this.checkProducts(sellerId, dto.productIds);
    return this.prisma.liveSale.create({
      data: {
        sellerId,
        title: dto.title.trim(),
        tiktokUsername: dto.tiktokUsername.replace(/^@/, '').trim(),
        scheduledAt: new Date(dto.scheduledAt),
        demo: dto.demo ?? false,
        productIds,
      },
      select: LIVE_SELECT,
    });
  }

  async updateLive(sellerId: string, id: string, dto: UpdateLiveDto) {
    const live = await this.ownLive(sellerId, id);
    if (live.status !== LiveSaleStatus.SCHEDULED) {
      throw new ConflictException('Seul un live pas encore commencé change');
    }
    return this.prisma.liveSale.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        tiktokUsername: dto.tiktokUsername?.replace(/^@/, '').trim(),
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        demo: dto.demo,
        productIds: dto.productIds
          ? await this.checkProducts(sellerId, dto.productIds)
          : undefined,
      },
      select: LIVE_SELECT,
    });
  }

  private async checkProducts(sellerId: string, ids: string[] = []) {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const found = await this.prisma.liveProduct.count({
      where: { id: { in: unique }, sellerId },
    });
    if (found !== unique.length) {
      throw new BadRequestException('Produit introuvable dans ton catalogue');
    }
    return unique;
  }

  listLives(sellerId: string) {
    return this.prisma.liveSale.findMany({
      where: { sellerId },
      select: { ...LIVE_SELECT, _count: { select: { leads: true } } },
      orderBy: { scheduledAt: 'desc' },
      take: 100,
    });
  }

  async ownLive(sellerId: string, id: string) {
    const live = await this.prisma.liveSale.findFirst({
      where: { id, sellerId },
      select: { ...LIVE_SELECT, sellerId: true },
    });
    if (!live) throw new NotFoundException('Live introuvable');
    return live;
  }

  /** Everything the live screen shows, read again every few seconds. */
  async dashboard(sellerId: string, id: string) {
    const live = await this.ownLive(sellerId, id);
    const [leads, comments, commentCount, catalog] = await Promise.all([
      this.prisma.liveLead.findMany({
        where: { liveId: id },
        select: LEAD_SELECT,
        orderBy: { lastAt: 'desc' },
      }),
      this.prisma.liveComment.findMany({
        where: { liveId: id },
        select: {
          id: true,
          tiktokUser: true,
          nickname: true,
          text: true,
          intent: true,
          by: true,
          at: true,
        },
        orderBy: { at: 'desc' },
        take: 40,
      }),
      this.prisma.liveComment.count({ where: { liveId: id } }),
      this.catalog(live.id),
    ]);
    const open = leads.filter((l) => l.status !== LiveLeadStatus.CANCELLED);
    const buyers = open.filter((l) => asItems(l.items).length > 0);
    return {
      live,
      stats: {
        comments: commentCount,
        interested: open.length,
        buyers: buyers.length,
        cancelled: leads.length - open.length,
        paid: leads.filter(
          (l) =>
            l.status === LiveLeadStatus.PAID ||
            l.status === LiveLeadStatus.DELIVERED,
        ).length,
        // "Ventes prévues": what the open carts are worth.
        forecast: buyers.reduce((sum, l) => sum + (l.total ?? 0), 0),
      },
      leads,
      comments,
      products: catalog.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        stock: p.stock,
        left: p.left,
      })),
    };
  }

  /** The products of a live, with what is left once the carts are counted. */
  async catalog(liveId: string) {
    const live = await this.prisma.liveSale.findUniqueOrThrow({
      where: { id: liveId },
      select: { sellerId: true, productIds: true },
    });
    const [products, leads] = await Promise.all([
      this.prisma.liveProduct.findMany({
        where: {
          sellerId: live.sellerId,
          active: true,
          ...(live.productIds.length ? { id: { in: live.productIds } } : {}),
        },
        select: PRODUCT_SELECT,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.liveLead.findMany({
        where: { liveId, status: { not: LiveLeadStatus.CANCELLED } },
        select: { items: true },
      }),
    ]);
    const reserved = new Map<string, number>();
    for (const l of leads) {
      for (const i of asItems(l.items)) {
        if (i.productId) {
          reserved.set(
            i.productId,
            (reserved.get(i.productId) ?? 0) + i.quantity,
          );
        }
      }
    }
    return products.map((p) => ({
      ...p,
      left:
        p.stock == null
          ? null
          : Math.max(0, p.stock - (reserved.get(p.id) ?? 0)),
    }));
  }

  async catalogForAi(liveId: string): Promise<CatalogEntry[]> {
    return (await this.catalog(liveId)).map((p) => ({
      id: p.id,
      nom: p.name,
      prix: p.price,
      ...(p.left != null ? { stock_restant: p.left } : {}),
    }));
  }

  async customersForAi(
    liveId: string,
    users: string[],
  ): Promise<CustomerContext[]> {
    const leads = await this.prisma.liveLead.findMany({
      where: { liveId, tiktokUser: { in: users } },
      select: {
        tiktokUser: true,
        items: true,
        status: true,
        comments: { select: { text: true }, orderBy: { at: 'desc' }, take: 5 },
      },
    });
    return users.map((user) => {
      const lead = leads.find((l) => l.tiktokUser === user);
      return {
        auteur: user,
        panier: asItems(lead?.items ?? []).map((i) => ({
          product_id: i.productId,
          produit: i.name,
          quantite: i.quantity,
          variante: i.variant,
        })),
        commande_annulee: lead?.status === LiveLeadStatus.CANCELLED,
        derniers_commentaires: (lead?.comments ?? [])
          .map((c) => c.text)
          .reverse(),
      };
    });
  }

  // --- While the live runs -------------------------------------------------

  /**
   * Saves a comment with its phone numbers masked. Returns the masked comment,
   * or null when TikTok sent the same message twice.
   */
  async recordComment(liveId: string, c: LiveCommentIn) {
    const { text, found } = maskPhones(c.text.slice(0, 500));
    try {
      await this.prisma.liveComment.create({
        data: {
          liveId,
          externalId: c.id.slice(0, 100),
          tiktokUser: c.user.slice(0, 100),
          nickname: c.nickname.slice(0, 100),
          text,
          at: new Date(c.at),
        },
      });
    } catch (e) {
      if (isUniqueError(e)) return null;
      throw e;
    }
    return { comment: { ...c, text }, phoneSeen: found };
  }

  /** One lead per customer and live; each new buying comment updates it. */
  async recordIntent(
    liveId: string,
    c: LiveCommentIn,
    result: IntentResult,
    phoneSeen = false,
  ) {
    const externalId = c.id.slice(0, 100);
    const comment = await this.prisma.liveComment.update({
      where: { liveId_externalId: { liveId, externalId } },
      data: { intent: result.intent, by: result.by },
      select: { id: true },
    });
    const existing = await this.prisma.liveLead.findUnique({
      where: { liveId_tiktokUser: { liveId, tiktokUser: c.user } },
      select: { id: true, intent: true, items: true, status: true },
    });
    if (!existing && !isInterested(result.intent)) return null;

    const products = (await this.catalog(liveId)).filter(
      (p) => p.left == null || p.left > 0,
    );
    let items = asItems(existing?.items ?? []);
    if (result.cart) {
      items = toItems(result.cart, products);
    } else if (result.intent === 'achat') {
      // Keyword mode: no cart from the AI, so look for the product in the text.
      const product = matchProduct(products, c.text);
      if (product) {
        const quantity = guessQuantity(c.text, product.name);
        const item = items.find((i) => i.productId === product.id);
        if (item) item.quantity = quantity ?? item.quantity;
        else
          items.push({
            productId: product.id,
            name: product.name,
            variant: null,
            quantity: quantity ?? 1,
            unitPrice: product.price,
          });
      }
    }

    // A purchase outranks a question; never downgrade a lead that wants to buy.
    const strong = (i: string) => i === 'achat' || i === 'annulation';
    const intent =
      !existing || strong(result.intent) || !strong(existing.intent)
        ? result.intent
        : existing.intent;
    let status = existing?.status ?? LiveLeadStatus.NEW;
    if (result.intent === 'annulation' && status !== LiveLeadStatus.PAID) {
      status = LiveLeadStatus.CANCELLED;
    } else if (
      result.intent === 'achat' &&
      status === LiveLeadStatus.CANCELLED
    ) {
      status = LiveLeadStatus.NEW;
    }
    const data = {
      intent,
      items: items as unknown as Prisma.InputJsonValue,
      total: cartTotal(items),
      reply: result.reply?.trim().slice(0, 300) || null,
      status,
      lastAt: new Date(c.at),
      ...(phoneSeen ? { phoneSeen: true } : {}),
    };

    let leadId: string;
    if (existing) {
      leadId = existing.id;
      await this.prisma.liveLead.update({ where: { id: leadId }, data });
    } else {
      leadId = await this.createLead(liveId, {
        ...data,
        tiktokUser: c.user.slice(0, 100),
        nickname: c.nickname.slice(0, 100),
        firstAt: new Date(c.at),
      });
    }
    await this.prisma.liveComment.update({
      where: { id: comment.id },
      data: { leadId },
    });
    return leadId;
  }

  /** Creates a lead with a fresh code, trying again on the rare collision. */
  private async createLead(
    liveId: string,
    data: Omit<Prisma.LiveLeadUncheckedCreateInput, 'liveId' | 'code'>,
  ) {
    for (let attempt = 0; ; attempt++) {
      try {
        const lead = await this.prisma.liveLead.create({
          data: { ...data, liveId, code: newLeadCode() },
          select: { id: true },
        });
        return lead.id;
      } catch (e) {
        if (!isUniqueError(e) || attempt >= 5) throw e;
        const taken = await this.prisma.liveLead.findUnique({
          where: {
            liveId_tiktokUser: { liveId, tiktokUser: String(data.tiktokUser) },
          },
          select: { id: true },
        });
        if (taken) return taken.id;
      }
    }
  }

  /** Manual mode: the seller adds a customer the AI missed. */
  async addManualLead(sellerId: string, liveId: string, dto: ManualLeadDto) {
    const live = await this.ownLive(sellerId, liveId);
    if (live.status !== LiveSaleStatus.RUNNING) {
      throw new ConflictException('Le live doit être en cours');
    }
    const user = dto.tiktokUser.replace(/^@/, '').trim();
    const exists = await this.prisma.liveLead.findUnique({
      where: { liveId_tiktokUser: { liveId, tiktokUser: user } },
      select: { id: true },
    });
    if (exists) throw new ConflictException('Ce client a déjà une carte');
    const products = await this.catalog(liveId);
    const items: CartItem[] = [];
    for (const line of dto.items ?? []) {
      const p = products.find((x) => x.id === line.productId);
      if (!p) throw new BadRequestException('Produit introuvable dans ce live');
      items.push({
        productId: p.id,
        name: p.name,
        variant: line.variant?.trim() || null,
        quantity: line.quantity,
        unitPrice: p.price,
      });
    }
    const id = await this.createLead(liveId, {
      tiktokUser: user,
      nickname: user,
      intent: 'achat',
      items: items as unknown as Prisma.InputJsonValue,
      total: cartTotal(items),
    });
    return this.prisma.liveLead.findUniqueOrThrow({
      where: { id },
      select: LEAD_SELECT,
    });
  }

  async setLeadStatus(
    sellerId: string,
    liveId: string,
    leadId: string,
    status: LiveLeadStatus,
  ) {
    await this.ownLive(sellerId, liveId);
    if (!SELLER_LEAD_STATUSES.includes(status)) {
      throw new BadRequestException('Statut inconnu');
    }
    const lead = await this.prisma.liveLead.findFirst({
      where: { id: leadId, liveId },
      select: { id: true },
    });
    if (!lead) throw new NotFoundException('Client introuvable');
    return this.prisma.liveLead.update({
      where: { id: leadId },
      data: { status },
      select: LEAD_SELECT,
    });
  }

  markStarted(id: string) {
    return this.prisma.liveSale.update({
      where: { id },
      data: {
        status: LiveSaleStatus.RUNNING,
        startedAt: new Date(),
        sourceState: 'connecting',
        sourceMessage: 'Connexion au live…',
      },
      select: LIVE_SELECT,
    });
  }

  setSource(id: string, state: string, message: string) {
    return this.prisma.liveSale.update({
      where: { id },
      data: { sourceState: state, sourceMessage: message.slice(0, 300) },
    });
  }

  setViewers(id: string, viewers: number) {
    return this.prisma.liveSale.update({ where: { id }, data: { viewers } });
  }

  markEnded(id: string) {
    return this.prisma.liveSale.update({
      where: { id },
      data: {
        status: LiveSaleStatus.ENDED,
        endedAt: new Date(),
        sourceState: 'stopped',
        sourceMessage: 'Live terminé.',
      },
      select: LIVE_SELECT,
    });
  }

  async cancelOwn(sellerId: string, id: string) {
    const live = await this.ownLive(sellerId, id);
    if (live.status !== LiveSaleStatus.SCHEDULED) {
      throw new ConflictException('Seul un live pas encore commencé s’annule');
    }
    return this.prisma.liveSale.update({
      where: { id },
      data: { status: LiveSaleStatus.CANCELLED },
      select: LIVE_SELECT,
    });
  }

  /** After a restart no connection runs: the seller presses "Reprendre". */
  markInterrupted() {
    return this.prisma.liveSale.updateMany({
      where: { status: LiveSaleStatus.RUNNING },
      data: {
        sourceState: 'disconnected',
        sourceMessage: 'Serveur redémarré : clique sur « Reprendre ».',
      },
    });
  }

  // --- Back-office ---------------------------------------------------------

  staffList(actor: StaffActor, status?: LiveSaleStatus) {
    const scope = countryScope(actor);
    return this.prisma.liveSale.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(scope ? { seller: { country: { in: scope } } } : {}),
      },
      select: {
        ...LIVE_SELECT,
        seller: {
          select: { id: true, phone: true, email: true, country: true },
        },
        _count: { select: { leads: true, comments: true } },
      },
      orderBy: { scheduledAt: 'desc' },
      take: 200,
    });
  }

  /** The team stops a live (fraud, complaint); its reading ends at once. */
  async staffCancel(actor: StaffActor, id: string, reason: string) {
    const live = await this.prisma.liveSale.findUnique({
      where: { id },
      select: {
        ...LIVE_SELECT,
        sellerId: true,
        seller: { select: { country: true } },
      },
    });
    if (!live) throw new NotFoundException('Live introuvable');
    assertCountry(actor, live.seller.country);
    assertNotSelf(actor, live.sellerId);
    if (
      live.status === LiveSaleStatus.ENDED ||
      live.status === LiveSaleStatus.CANCELLED
    ) {
      throw new ConflictException('Ce live est déjà fini');
    }
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.liveSale.update({
        where: { id },
        data: {
          status: LiveSaleStatus.CANCELLED,
          endedAt: live.startedAt ? new Date() : null,
          cancelReason: reason,
          sourceState: 'stopped',
          sourceMessage: 'Live arrêté par l’équipe Viewzo.',
        },
        select: LIVE_SELECT,
      });
      await this.audit.record(tx, {
        actor,
        action: 'live.cancel',
        entity: 'LiveSale',
        entityId: id,
        before: { status: live.status },
        after: { status: after.status },
        reason,
      });
      return after;
    });
  }
}
