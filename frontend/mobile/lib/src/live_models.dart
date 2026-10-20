// Live selling on TikTok (module LIVE_SALES, switched on in the back-office).

const liveStatusLabels = {
  'SCHEDULED': 'Planifié',
  'RUNNING': 'En direct',
  'ENDED': 'Terminé',
  'CANCELLED': 'Annulé',
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

class LiveSale {
  LiveSale({
    required this.id,
    required this.title,
    required this.tiktokUsername,
    required this.scheduledAt,
    required this.demo,
    required this.status,
    this.viewers,
    this.sourceState,
    this.sourceMessage,
    this.cancelReason,
    this.leads = 0,
  });

  factory LiveSale.fromJson(Map<String, dynamic> json) => LiveSale(
    id: json['id'] as String,
    title: json['title'] as String,
    tiktokUsername: json['tiktokUsername'] as String,
    scheduledAt: DateTime.parse(json['scheduledAt'] as String).toLocal(),
    demo: json['demo'] as bool,
    status: json['status'] as String,
    viewers: json['viewers'] as int?,
    sourceState: json['sourceState'] as String?,
    sourceMessage: json['sourceMessage'] as String?,
    cancelReason: json['cancelReason'] as String?,
    leads: (json['_count'] as Map<String, dynamic>?)?['leads'] as int? ?? 0,
  );

  final String id;
  final String title;
  final String tiktokUsername;
  final DateTime scheduledAt;
  final bool demo;
  final String status;
  final int? viewers;
  final String? sourceState;
  final String? sourceMessage;
  final String? cancelReason;
  final int leads;

  bool get running => status == 'RUNNING';
  bool get finished => status == 'ENDED' || status == 'CANCELLED';
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

  /// The buyer sends it on WhatsApp to give their number.
  final String code;
  final String tiktokUser;
  final String nickname;
  final String intent;
  final List<LeadItem> items;
  final String status;

  /// A number was written in a comment; it was masked, never kept.
  final bool phoneSeen;
  final int? total;
  final String? reply;
}

class LiveBoard {
  LiveBoard({
    required this.live,
    required this.comments,
    required this.interested,
    required this.buyers,
    required this.paid,
    required this.forecast,
    required this.leads,
    required this.running,
    required this.ai,
  });

  factory LiveBoard.fromJson(Map<String, dynamic> json) {
    final stats = json['stats'] as Map<String, dynamic>;
    return LiveBoard(
      live: LiveSale.fromJson(json['live'] as Map<String, dynamic>),
      comments: stats['comments'] as int,
      interested: stats['interested'] as int,
      buyers: stats['buyers'] as int,
      paid: stats['paid'] as int,
      forecast: stats['forecast'] as int,
      leads: [
        for (final l in json['leads'] as List)
          LiveLead.fromJson(l as Map<String, dynamic>),
      ],
      running: json['running'] as bool,
      ai: json['ai'] as bool,
    );
  }

  final LiveSale live;
  final int comments;
  final int interested;
  final int buyers;
  final int paid;
  final int forecast;
  final List<LiveLead> leads;

  /// The server is reading the comments right now.
  final bool running;
  final bool ai;
}
