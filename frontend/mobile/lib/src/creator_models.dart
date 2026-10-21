enum SocialNetwork {
  tiktok('TIKTOK', 'TikTok'),
  instagram('INSTAGRAM', 'Instagram'),
  facebook('FACEBOOK', 'Facebook'),
  youtube('YOUTUBE', 'YouTube'),
  snapchat('SNAPCHAT', 'Snapchat'),
  x('X', 'X'),
  linkedin('LINKEDIN', 'LinkedIn'),
  threads('THREADS', 'Threads'),
  telegram('TELEGRAM', 'Telegram'),
  whatsappStatus('WHATSAPP_STATUS', 'WhatsApp Statut');

  const SocialNetwork(this.code, this.label);
  final String code;
  final String label;

  static SocialNetwork fromCode(String code) =>
      values.firstWhere((n) => n.code == code);
}

enum AccountStatus {
  pending('PENDING', 'En vérification'),
  eligible('ELIGIBLE', 'Éligible'),
  needsFix('NEEDS_FIX', 'À corriger'),
  notEligible('NOT_ELIGIBLE', 'Non éligible'),
  suspended('SUSPENDED', 'Suspendu');

  const AccountStatus(this.code, this.label);
  final String code;
  final String label;

  static AccountStatus fromCode(String code) =>
      values.firstWhere((s) => s.code == code);
}

/// How the creator proves the account is theirs: a code in the bio, or a
/// WhatsApp message to the official verification number.
class Verification {
  Verification({
    required this.isWhatsapp,
    required this.code,
    this.contactNumber,
    this.messageText,
    this.whatsappLink,
  });

  factory Verification.fromJson(Map<String, dynamic> json) => Verification(
    isWhatsapp: json['kind'] == 'WHATSAPP',
    code: json['code'] as String,
    contactNumber: json['contactNumber'] as String?,
    messageText: json['messageText'] as String?,
    whatsappLink: json['whatsappLink'] as String?,
  );

  final bool isWhatsapp;
  final String code;
  final String? contactNumber;
  final String? messageText;
  final String? whatsappLink;
}

class SocialAccount {
  SocialAccount({
    required this.id,
    required this.network,
    required this.handle,
    required this.status,
    this.statusReason,
    this.retryAfter,
    this.reviewDueAt,
    this.followers,
    this.avgStatusViews,
    this.declaredFollowers,
    this.verification,
  });

  factory SocialAccount.fromJson(Map<String, dynamic> json) => SocialAccount(
    id: json['id'] as String,
    network: SocialNetwork.fromCode(json['network'] as String),
    handle: json['handle'] as String,
    status: AccountStatus.fromCode(json['status'] as String),
    statusReason: json['statusReason'] as String?,
    retryAfter: _date(json['retryAfter']),
    reviewDueAt: _date(json['reviewDueAt']),
    followers: json['followers'] as int?,
    avgStatusViews: json['avgStatusViews'] as int?,
    declaredFollowers: json['declaredFollowers'] as int?,
    verification: json['verification'] == null
        ? null
        : Verification.fromJson(json['verification'] as Map<String, dynamic>),
  );

  final String id;
  final SocialNetwork network;
  final String handle;
  final AccountStatus status;
  final String? statusReason;
  final DateTime? retryAfter;
  final DateTime? reviewDueAt;
  final int? followers;
  // WhatsApp Statut: average viewers per status.
  final int? avgStatusViews;
  // What the creator said when adding the account, until the team confirms.
  final int? declaredFollowers;
  final Verification? verification;

  /// The confirmed audience: followers, or viewers per status for WhatsApp.
  int? get audience =>
      network == SocialNetwork.whatsappStatus ? avgStatusViews : followers;

  /// "@name", or the number for WhatsApp Statut.
  String get displayHandle =>
      network == SocialNetwork.whatsappStatus ? handle : '@$handle';

  bool get canResubmit =>
      status == AccountStatus.needsFix ||
      (status == AccountStatus.notEligible &&
          (retryAfter == null || retryAfter!.isBefore(DateTime.now())));

  bool get canRemove =>
      status != AccountStatus.suspended &&
      !(status == AccountStatus.notEligible && !canResubmit);
}

DateTime? _date(Object? value) =>
    value == null ? null : DateTime.parse(value as String).toLocal();

enum CreatorTaskType {
  postVisual('POST_PROVIDED_VISUAL', 'Publier des visuels fournis'),
  postVideo('POST_PROVIDED_VIDEO', 'Publier des vidéos fournies'),
  createVideo('CREATE_ORIGINAL_VIDEO', 'Créer des vidéos originales'),
  liveSelling('LIVE_SELLING', 'Faire des lives de vente');

  const CreatorTaskType(this.code, this.label);
  final String code;
  final String label;
}

enum CreatorSpecialty {
  facecam('FACECAM', 'Facecam'),
  vlog('VLOG', 'Vlog'),
  productDemo('PRODUCT_DEMO', 'Démo ou test produit'),
  unboxing('UNBOXING', 'Unboxing'),
  tutorial('TUTORIAL', 'Tutoriel'),
  dance('DANCE_CHALLENGE', 'Danse ou challenge'),
  humor('HUMOR_SKETCH', 'Humour ou sketch'),
  streetInterview('STREET_INTERVIEW', 'Micro-trottoir'),
  fullEditing('FULL_EDITING', 'Montage complet'),
  motionDesign('MOTION_DESIGN', 'Motion design'),
  voiceOver('VOICE_OVER', 'Voix off'),
  productPhoto('PRODUCT_PHOTO', 'Photo produit');

  const CreatorSpecialty(this.code, this.label);
  final String code;
  final String label;
}

const creatorThemes = [
  'Mode',
  'Beauté',
  'Tech',
  'Food',
  'Sport',
  'Musique',
  'Finance',
  'Éducation',
];

/// Answers to the creator skills form.
class CreatorSkills {
  CreatorSkills({
    required this.taskTypes,
    required this.specialties,
    required this.showsFace,
    this.phoneModel,
    this.microphone,
    this.lighting,
    this.editingSoftware,
    required this.exampleLinks,
    required this.languages,
    required this.countries,
    required this.cities,
    required this.themes,
    required this.tasksPerWeek,
  });

  factory CreatorSkills.fromJson(Map<String, dynamic> json) {
    List<String> strings(String key) => [
      for (final v in json[key] as List) v as String,
    ];
    return CreatorSkills(
      taskTypes: {
        for (final c in strings('taskTypes'))
          CreatorTaskType.values.firstWhere((t) => t.code == c),
      },
      specialties: {
        for (final c in strings('specialties'))
          CreatorSpecialty.values.firstWhere((s) => s.code == c),
      },
      showsFace: json['showsFace'] as bool,
      phoneModel: json['phoneModel'] as String?,
      microphone: json['microphone'] as String?,
      lighting: json['lighting'] as String?,
      editingSoftware: json['editingSoftware'] as String?,
      exampleLinks: strings('exampleLinks'),
      languages: strings('languages'),
      countries: strings('countries'),
      cities: strings('cities'),
      themes: strings('themes'),
      tasksPerWeek: json['tasksPerWeek'] as int,
    );
  }

  final Set<CreatorTaskType> taskTypes;
  final Set<CreatorSpecialty> specialties;
  final bool showsFace;
  final String? phoneModel;
  final String? microphone;
  final String? lighting;
  final String? editingSoftware;
  final List<String> exampleLinks;
  final List<String> languages;
  final List<String> countries;
  final List<String> cities;
  final List<String> themes;
  final int tasksPerWeek;

  Map<String, dynamic> toJson() => {
    'taskTypes': [for (final t in taskTypes) t.code],
    'specialties': [for (final s in specialties) s.code],
    'showsFace': showsFace,
    if (phoneModel != null) 'phoneModel': phoneModel,
    if (microphone != null) 'microphone': microphone,
    if (lighting != null) 'lighting': lighting,
    if (editingSoftware != null) 'editingSoftware': editingSoftware,
    'exampleLinks': exampleLinks,
    'languages': languages,
    'countries': countries,
    'cities': cities,
    'themes': themes,
    'tasksPerWeek': tasksPerWeek,
  };
}
