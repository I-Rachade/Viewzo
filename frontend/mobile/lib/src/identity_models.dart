/// One identity verification (ID document and selfie) for level 2.
class IdentityCheck {
  IdentityCheck({
    required this.id,
    required this.status,
    this.fullName,
    this.reason,
  });

  factory IdentityCheck.fromJson(Map<String, dynamic> json) => IdentityCheck(
    id: json['id'] as String,
    status: json['status'] as String,
    fullName: json['fullName'] as String?,
    reason: json['reason'] as String?,
  );

  final String id;
  // STARTED, IN_REVIEW, APPROVED, DECLINED or ABANDONED.
  final String status;
  final String? fullName;
  final String? reason;
}

class IdentityStatus {
  IdentityStatus({
    required this.available,
    required this.verified,
    required this.needsProfile,
    this.check,
    this.retryAfter,
  });

  factory IdentityStatus.fromJson(Map<String, dynamic> json) => IdentityStatus(
    available: json['available'] as bool,
    verified: json['verified'] as bool,
    needsProfile: json['needsProfile'] as bool,
    check: json['check'] == null
        ? null
        : IdentityCheck.fromJson(json['check'] as Map<String, dynamic>),
    retryAfter: json['retryAfter'] == null
        ? null
        : DateTime.parse(json['retryAfter'] as String),
  );

  // False until the verification provider is set up.
  final bool available;
  final bool verified;
  final bool needsProfile;
  final IdentityCheck? check;
  final DateTime? retryAfter;
}

const identityStatusLabels = {
  'STARTED': 'Commencée',
  'IN_REVIEW': 'En examen par l’équipe',
  'APPROVED': 'Vérifiée',
  'DECLINED': 'Refusée',
  'ABANDONED': 'Interrompue',
};
