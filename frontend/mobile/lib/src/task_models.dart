import 'creator_models.dart';

enum ContentType {
  providedAssets('PROVIDED_ASSETS', 'Publier les éléments fournis'),
  videoWithPosters('VIDEO_WITH_POSTERS', 'Vidéo avec les affiches'),
  facecam('FACECAM', 'Face caméra'),
  vlogDemoUnboxing('VLOG_DEMO_UNBOXING', 'Vlog, démo ou unboxing'),
  fullEditing('FULL_EDITING', 'Montage complet'),
  motionDesign('MOTION_DESIGN', 'Motion design'),
  freeBrief('FREE_BRIEF', 'Brief libre');

  const ContentType(this.code, this.label);
  final String code;
  final String label;

  static ContentType fromCode(String code) =>
      values.firstWhere((t) => t.code == code);
}

/// A file the advertiser sent, opened through a signed link.
class BriefFile {
  BriefFile({
    required this.name,
    required this.kind,
    required this.purpose,
    required this.url,
  });

  factory BriefFile.fromJson(Map<String, dynamic> json) => BriefFile(
    name: json['name'] as String,
    kind: json['kind'] as String,
    purpose: json['purpose'] as String,
    url: json['url'] as String,
  );

  final String name;

  /// IMAGE, VIDEO, AUDIO or PDF.
  final String kind;

  /// ASSET for the content, BRIEF for a voice or video brief.
  final String purpose;
  final String url;
}

/// The brief a creator sees; never the advertiser's budget.
class TaskBrief {
  TaskBrief({
    required this.title,
    required this.hashtag,
    required this.endsAt,
    required this.assetUrls,
    this.files = const [],
    this.keyMessage,
    this.callToAction,
    this.caption,
    this.sound,
    this.productDetails,
    required this.faceRequired,
    required this.language,
    this.minDurationSec,
    this.maxDurationSec,
    this.tone,
    required this.mandatoryElements,
    required this.forbiddenElements,
    required this.examples,
  });

  factory TaskBrief.fromJson(Map<String, dynamic> json) => TaskBrief(
    title: json['title'] as String,
    hashtag: json['hashtag'] as String,
    endsAt: DateTime.parse(json['endsAt'] as String).toLocal(),
    assetUrls: _strings(json['assetUrls']),
    files: [
      for (final f in json['files'] as List<dynamic>? ?? const [])
        BriefFile.fromJson(f as Map<String, dynamic>),
    ],
    keyMessage: json['keyMessage'] as String?,
    callToAction: json['callToAction'] as String?,
    caption: json['caption'] as String?,
    sound: json['sound'] as String?,
    productDetails: json['productDetails'] as String?,
    faceRequired: json['faceRequired'] as bool? ?? false,
    language: json['language'] as String,
    minDurationSec: json['minDurationSec'] as int?,
    maxDurationSec: json['maxDurationSec'] as int?,
    tone: json['tone'] as String?,
    mandatoryElements: _strings(json['mandatoryElements']),
    forbiddenElements: _strings(json['forbiddenElements']),
    examples: _strings(json['examples']),
  );

  final String title;
  final String hashtag;
  final DateTime endsAt;
  final List<String> assetUrls;
  final List<BriefFile> files;
  final String? keyMessage;
  final String? callToAction;

  /// Text to put under the post.
  final String? caption;

  /// Sound or music to use.
  final String? sound;
  final String? productDetails;
  final bool faceRequired;
  final String language;
  final int? minDurationSec;
  final int? maxDurationSec;
  final String? tone;
  final List<String> mandatoryElements;
  final List<String> forbiddenElements;
  final List<String> examples;
}

class CampaignTask {
  CampaignTask({
    required this.id,
    required this.network,
    required this.contentType,
    required this.ratePer1000,
    required this.brief,
    this.locked = false,
  });

  factory CampaignTask.fromJson(Map<String, dynamic> json) => CampaignTask(
    id: json['id'] as String,
    network: SocialNetwork.fromCode(json['network'] as String),
    contentType: ContentType.fromCode(json['contentType'] as String),
    ratePer1000: json['creatorRatePer1000'] as int,
    brief: TaskBrief.fromJson(json['campaign'] as Map<String, dynamic>),
    locked: json['locked'] as bool? ?? false,
  );

  final String id;
  final SocialNetwork network;
  final ContentType contentType;
  // FCFA the creator earns per 1,000 views.
  final int ratePer1000;
  final TaskBrief brief;
  // No eligible account on the network yet: shown, but it can't be accepted.
  final bool locked;
}

/// The team's decision on a published post.
enum ReviewStatus {
  toReview('TO_REVIEW', 'En vérification'),
  validated('VALIDATED', 'Validé'),
  needsFix('NEEDS_FIX', 'À corriger'),
  rejected('REJECTED', 'Refusé');

  const ReviewStatus(this.code, this.label);
  final String code;
  final String label;

  static ReviewStatus fromCode(String? code) =>
      values.firstWhere((s) => s.code == code, orElse: () => toReview);
}

/// One screenshot of the WhatsApp Statut schedule: when it is due, and
/// when it was sent.
class ProofStep {
  ProofStep({required this.label, this.dueAt, this.doneAt});

  factory ProofStep.fromJson(Map<String, dynamic> json) => ProofStep(
    label: json['label'] as String,
    dueAt: _date(json['dueAt']),
    doneAt: _date(json['doneAt']),
  );

  final String label;
  final DateTime? dueAt;
  final DateTime? doneAt;
}

class Assignment {
  Assignment({
    required this.id,
    required this.submitted,
    this.postUrl,
    required this.task,
    this.reviewStatus = ReviewStatus.toReview,
    this.reviewReason,
    this.validViews = 0,
    this.earned = 0,
    this.declaredViews,
    this.screenshots = 0,
    this.proofSteps = const [],
    this.nextProofAt,
  });

  factory Assignment.fromJson(Map<String, dynamic> json) {
    final plan = json['proofPlan'] as Map<String, dynamic>?;
    return Assignment(
      id: json['id'] as String,
      submitted: json['status'] == 'SUBMITTED',
      postUrl: json['postUrl'] as String?,
      task: CampaignTask.fromJson(json['task'] as Map<String, dynamic>),
      reviewStatus: ReviewStatus.fromCode(json['reviewStatus'] as String?),
      reviewReason: json['reviewReason'] as String?,
      validViews: json['validViews'] as int? ?? 0,
      earned: json['earned'] as int? ?? 0,
      declaredViews: json['declaredViews'] as int?,
      screenshots: [
        for (final p in json['proofs'] as List? ?? const [])
          if ((p as Map)['kind'] == 'SCREENSHOT') p,
      ].length,
      proofSteps: [
        for (final s in plan?['steps'] as List? ?? const [])
          ProofStep.fromJson(s as Map<String, dynamic>),
      ],
      nextProofAt: _date(plan?['nextDueAt']),
    );
  }

  final String id;
  final bool submitted;
  final String? postUrl;
  final CampaignTask task;
  final ReviewStatus reviewStatus;

  /// Why the team asked for a fix or refused, shown to the creator.
  final String? reviewReason;
  final int validViews;
  final int earned;
  final int? declaredViews;
  final int screenshots;

  /// Empty except for WhatsApp Statut tasks.
  final List<ProofStep> proofSteps;
  final DateTime? nextProofAt;
}

/// "Mes résultats": what the team validated and what it paid.
class CreatorResults {
  CreatorResults({
    required this.validViews,
    required this.earned,
    required this.earnedThisMonth,
    required this.toReview,
    required this.needsFix,
    required this.validated,
    required this.rejected,
    this.validationRate,
  });

  factory CreatorResults.fromJson(Map<String, dynamic> json) => CreatorResults(
    validViews: json['validViews'] as int,
    earned: json['earned'] as int,
    earnedThisMonth: json['earnedThisMonth'] as int,
    toReview: json['toReview'] as int,
    needsFix: json['needsFix'] as int,
    validated: json['validated'] as int,
    rejected: json['rejected'] as int,
    validationRate: json['validationRate'] as int?,
  );

  final int validViews;
  final int earned;
  final int earnedThisMonth;
  final int toReview;
  final int needsFix;
  final int validated;
  final int rejected;
  final int? validationRate;
}

class AppNotification {
  AppNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.createdAt,
    this.link,
    required this.read,
  });

  factory AppNotification.fromJson(Map<String, dynamic> json) =>
      AppNotification(
        id: json['id'] as String,
        title: json['title'] as String,
        body: json['body'] as String,
        createdAt: DateTime.parse(json['createdAt'] as String).toLocal(),
        link: json['link'] as String?,
        read: json['readAt'] != null,
      );

  final String id;
  final String title;
  final String body;
  final DateTime createdAt;

  /// The screen it is about: /taches, /resultats, /wallet, /comptes…
  final String? link;
  final bool read;
}

/// A platform account the creator connected so Viewzo reads the views.
class Connection {
  Connection({
    required this.network,
    required this.available,
    required this.connected,
    this.handle,
    this.lastError,
  });

  factory Connection.fromJson(Map<String, dynamic> json) => Connection(
    network: SocialNetwork.fromCode(json['network'] as String),
    available: json['available'] as bool,
    connected: json['connected'] as bool,
    handle: json['handle'] as String?,
    lastError: json['lastError'] as String?,
  );

  final SocialNetwork network;

  /// False until Viewzo has the platform's app keys.
  final bool available;
  final bool connected;
  final String? handle;
  final String? lastError;
}

DateTime? _date(Object? value) =>
    value == null ? null : DateTime.parse(value as String).toLocal();

List<String> _strings(Object? value) => [
  for (final v in value as List? ?? const []) v as String,
];
