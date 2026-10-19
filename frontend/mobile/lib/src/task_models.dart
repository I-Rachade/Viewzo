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

/// The brief a creator sees; never the advertiser's budget.
class TaskBrief {
  TaskBrief({
    required this.title,
    required this.hashtag,
    required this.endsAt,
    required this.assetUrls,
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
  });

  factory CampaignTask.fromJson(Map<String, dynamic> json) => CampaignTask(
    id: json['id'] as String,
    network: SocialNetwork.fromCode(json['network'] as String),
    contentType: ContentType.fromCode(json['contentType'] as String),
    ratePer1000: json['creatorRatePer1000'] as int,
    brief: TaskBrief.fromJson(json['campaign'] as Map<String, dynamic>),
  );

  final String id;
  final SocialNetwork network;
  final ContentType contentType;
  // FCFA the creator earns per 1,000 views.
  final int ratePer1000;
  final TaskBrief brief;
}

class Assignment {
  Assignment({
    required this.id,
    required this.submitted,
    this.postUrl,
    required this.task,
  });

  factory Assignment.fromJson(Map<String, dynamic> json) => Assignment(
    id: json['id'] as String,
    submitted: json['status'] == 'SUBMITTED',
    postUrl: json['postUrl'] as String?,
    task: CampaignTask.fromJson(json['task'] as Map<String, dynamic>),
  );

  final String id;
  final bool submitted;
  final String? postUrl;
  final CampaignTask task;
}

List<String> _strings(Object? value) => [
  for (final v in value as List? ?? const []) v as String,
];
