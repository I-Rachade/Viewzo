// Live selling on TikTok (module LIVE_SALES, switched on in the back-office).
// An offer (LiveSale) is sold in one or more TikTok lives (LiveSession):
// the creators' who accepted it, or the advertiser's own.

const liveStatusLabels = {
  'PENDING_PAYMENT': 'À payer',
  'PENDING_REVIEW': 'En vérification',
  'ACTIVE': 'Ouverte',
  'COMPLETED': 'Terminée',
  'REJECTED': 'Refusée',
  'CANCELLED': 'Annulée',
};

const sessionStatusLabels = {
  'INVITED': 'Invité',
  'ACCEPTED': 'Prévu',
  'RUNNING': 'En direct',
  'ENDED': 'Terminé',
  'WITHDRAWN': 'Retiré',
  'DECLINED': 'A refusé',
  'MISSED': 'Non fait',
  'CANCELLED': 'Annulé',
};

const payoutLabels = {
  'NONE': 'Pas de gain',
  'TO_REVIEW': 'Audience en vérification',
  'PAID': 'Payé',
  'REFUSED': 'Paiement refusé',
};

const leadStatusLabels = {
  'NEW': 'Nouveau',
  'CONTACTED': 'Contacté',
  'PAID': 'Payé',
  'DELIVERED': 'Livré',
  'CANCELLED': 'Annulé',
};

const intentLabels = {
  'achat': 'Achat',
  'question_prix': 'Prix',
  'question_produit': 'Question',
  'question_livraison': 'Livraison',
  'annulation': 'Annulation',
  'autre': 'Autre',
};

DateTime? _date(Object? value) =>
    value == null ? null : DateTime.parse(value as String).toLocal();

class LiveSale {
  LiveSale({
    required this.id,
    required this.title,
    required this.self,
    required this.startsAt,
    required this.demo,
    required this.status,
    required this.slots,
    required this.budget,
    required this.spent,
    required this.refunded,
    required this.funded,
    this.endsAt,
    this.whatsapp,
    this.serviceFee,
    this.statusReason,
    this.leads = 0,
    this.sessions = const [],
  });

  factory LiveSale.fromJson(Map<String, dynamic> json) => LiveSale(
    id: json['id'] as String,
    title: json['title'] as String,
    self: json['mode'] == 'SELF',
    startsAt: _date(json['startsAt'])!,
    endsAt: _date(json['endsAt']),
    demo: json['demo'] as bool,
    status: json['status'] as String,
    slots: json['slots'] as int,
    budget: json['budget'] as int,
    spent: json['spent'] as int,
    refunded: json['refunded'] as int,
    funded: json['fundedAt'] != null,
    whatsapp: json['whatsapp'] as String?,
    serviceFee: json['serviceFee'] as int?,
    statusReason: json['statusReason'] as String?,
    leads: (json['_count'] as Map<String, dynamic>?)?['leads'] as int? ?? 0,
    sessions: [
      for (final s in (json['sessions'] as List?) ?? const [])
        (
          status: s['status'] as String,
          tiktokUsername: s['tiktokUsername'] as String,
        ),
    ],
  );

  final String id;
  final String title;

  /// The advertiser's own live, not sold by creators.
  final bool self;

  /// Creators: the period they choose their hour in. Own live: its time.
  final DateTime startsAt;
  final DateTime? endsAt;
  final bool demo;
  final String status;
  final int slots;
  final int budget;
  final int spent;
  final int refunded;
  final bool funded;

  /// Buyers write to it with their code.
  final String? whatsapp;
  final int? serviceFee;
  final String? statusReason;
  final int leads;
  final List<({String status, String tiktokUsername})> sessions;

  bool get closed =>
      status == 'COMPLETED' || status == 'REJECTED' || status == 'CANCELLED';
}

/// One TikTok live selling an offer.
class LiveSession {
  LiveSession({
    required this.id,
    required this.tiktokUsername,
    required this.status,
    required this.peakViewers,
    required this.payout,
    required this.earned,
    required this.cost,
    this.creatorName,
    this.followers,
    this.scheduledAt,
    this.startedAt,
    this.viewers,
    this.sourceState,
    this.sourceMessage,
    this.payoutReason,
    this.reading,
  });

  factory LiveSession.fromJson(Map<String, dynamic> json) => LiveSession(
    id: json['id'] as String,
    tiktokUsername: json['tiktokUsername'] as String,
    status: json['status'] as String,
    peakViewers: json['peakViewers'] as int,
    payout: json['payout'] as String,
    earned: json['earned'] as int,
    cost: json['cost'] as int,
    creatorName:
        (json['creator'] as Map<String, dynamic>?)?['firstName'] as String?,
    followers: json['followers'] as int?,
    scheduledAt: _date(json['scheduledAt']),
    startedAt: _date(json['startedAt']),
    viewers: json['viewers'] as int?,
    sourceState: json['sourceState'] as String?,
    sourceMessage: json['sourceMessage'] as String?,
    payoutReason: json['payoutReason'] as String?,
    reading: json['running'] as bool?,
  );

  final String id;
  final String tiktokUsername;
  final String status;
  final int peakViewers;
  final String payout;
  final int earned;
  final int cost;
  final String? creatorName;
  final int? followers;
  final DateTime? scheduledAt;
  final DateTime? startedAt;
  final int? viewers;
  final String? sourceState;
  final String? sourceMessage;
  final String? payoutReason;

  /// The server is reading the comments right now (advertiser's board).
  final bool? reading;

  bool get running => status == 'RUNNING';
}

class LeadItem {
  LeadItem(this.name, this.quantity, this.variant, this.unitPrice);
  final String name;
  final int quantity;
  final String? variant;
  final int? unitPrice;
}

class LiveLead {
  LiveLead({
    required this.id,
    required this.sessionId,
    required this.code,
    required this.tiktokUser,
    required this.nickname,
    required this.intent,
    required this.items,
    required this.status,
    required this.phoneSeen,
    this.total,
    this.reply,
  });

  factory LiveLead.fromJson(Map<String, dynamic> json) => LiveLead(
    id: json['id'] as String,
    sessionId: json['sessionId'] as String,
    code: json['code'] as String,
    tiktokUser: json['tiktokUser'] as String,
    nickname: json['nickname'] as String,
    intent: json['intent'] as String,
    items: [
      for (final i in json['items'] as List)
        LeadItem(
          i['name'] as String,
          i['quantity'] as int,
          i['variant'] as String?,
          i['unitPrice'] as int?,
        ),
    ],
    status: json['status'] as String,
    phoneSeen: json['phoneSeen'] as bool,
    total: json['total'] as int?,
    reply: json['reply'] as String?,
  );

  final String id;
  final String sessionId;

  /// The buyer sends it to the shop on WhatsApp.
  final String code;
  final String tiktokUser;
  final String nickname;
  final String intent;
  final List<LeadItem> items;
  final String status;

  /// A number was written in a comment; it was masked, never kept.
  final bool phoneSeen;
  final int? total;

  /// What to say in the live, ending with the shop's WhatsApp and the code.
  final String? reply;
}

class LiveStats {
  LiveStats.fromJson(Map<String, dynamic> json)
    : comments = json['comments'] as int,
      interested = json['interested'] as int,
      buyers = json['buyers'] as int,
      paid = json['paid'] as int,
      forecast = json['forecast'] as int;

  final int comments;
  final int interested;
  final int buyers;
  final int paid;
  final int forecast;
}

List<LiveLead> _leads(Object? list) => [
  for (final l in list as List) LiveLead.fromJson(l as Map<String, dynamic>),
];

/// The advertiser's view of an offer.
class LiveBoard {
  LiveBoard.fromJson(Map<String, dynamic> json)
    : live = LiveSale.fromJson(json['live'] as Map<String, dynamic>),
      sessions = [
        for (final s in json['sessions'] as List)
          LiveSession.fromJson(s as Map<String, dynamic>),
      ],
      stats = LiveStats.fromJson(json['stats'] as Map<String, dynamic>),
      leads = _leads(json['leads']),
      ai = json['ai'] as bool;

  final LiveSale live;
  final List<LiveSession> sessions;
  final LiveStats stats;
  final List<LiveLead> leads;
  final bool ai;
}

// ---- Creators ----

class LiveOffer {
  LiveOffer.fromJson(Map<String, dynamic> json)
    : id = json['id'] as String,
      title = json['title'] as String,
      shop = json['shop'] as String?,
      startsAt = _date(json['startsAt'])!,
      endsAt = _date(json['endsAt']),
      demo = json['demo'] as bool,
      ratePer100 = json['ratePer100'] as int,
      maxEarning = json['maxEarning'] as int,
      placesLeft = json['placesLeft'] as int?,
      products = [
        for (final p in json['products'] as List)
          (name: p['name'] as String, price: p['price'] as int),
      ];

  final String id;
  final String title;
  final String? shop;
  final DateTime startsAt;
  final DateTime? endsAt;
  final bool demo;

  /// What the creator earns per 100 viewers at the peak, and at most.
  final int ratePer100;
  final int maxEarning;
  final int? placesLeft;
  final List<({String name, int price})> products;
}

class CreatorSession {
  CreatorSession.fromJson(Map<String, dynamic> json)
    : id = json['id'] as String,
      status = json['status'] as String,
      scheduledAt = _date(json['scheduledAt']),
      startedAt = _date(json['startedAt']),
      peakViewers = json['peakViewers'] as int,
      payout = json['payout'] as String,
      earned = json['earned'] as int,
      payoutReason = json['payoutReason'] as String?,
      offer = LiveOffer.fromJson(json['offer'] as Map<String, dynamic>);

  final String id;
  final String status;
  final DateTime? scheduledAt;
  final DateTime? startedAt;
  final int peakViewers;
  final String payout;
  final int earned;
  final String? payoutReason;
  final LiveOffer offer;
}

class CreatorLiveHome {
  CreatorLiveHome.fromJson(Map<String, dynamic> json)
    : eligible = (json['eligibility'] as Map)['eligible'] as bool,
      reason = (json['eligibility'] as Map)['reason'] as String?,
      tiktok = switch ((json['eligibility'] as Map)['tiktok']) {
        final Map t => (
          username: t['username'] as String,
          followers: t['followers'] as int,
        ),
        _ => null,
      },
      minMinutes = (json['rules'] as Map)['minMinutes'] as int,
      blockDays = (json['rules'] as Map)['blockDays'] as int,
      banAfter = (json['rules'] as Map)['banAfter'] as int,
      offers = [
        for (final o in json['offers'] as List)
          LiveOffer.fromJson(o as Map<String, dynamic>),
      ],
      sessions = [
        for (final s in json['sessions'] as List)
          CreatorSession.fromJson(s as Map<String, dynamic>),
      ];

  final bool eligible;

  /// Why the creator cannot accept lives.
  final String? reason;
  final ({String username, int followers})? tiktok;
  final int minMinutes;
  final int blockDays;
  final int banAfter;
  final List<LiveOffer> offers;
  final List<CreatorSession> sessions;
}

/// A creator's own live: their buyers only.
class CreatorLiveBoard {
  CreatorLiveBoard.fromJson(Map<String, dynamic> json)
    : title = (json['live'] as Map)['title'] as String,
      shop = (json['live'] as Map)['shop'] as String?,
      startsAt = _date((json['live'] as Map)['startsAt'])!,
      session = LiveSession.fromJson(json['session'] as Map<String, dynamic>),
      reading = json['running'] as bool,
      ai = json['ai'] as bool,
      stats = LiveStats.fromJson(json['stats'] as Map<String, dynamic>),
      leads = _leads(json['leads']);

  final String title;
  final String? shop;
  final DateTime startsAt;
  final LiveSession session;

  /// The server is reading the comments right now.
  final bool reading;
  final bool ai;
  final LiveStats stats;
  final List<LiveLead> leads;
}
