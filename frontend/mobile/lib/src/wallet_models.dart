class WalletSummary {
  WalletSummary({
    required this.available,
    required this.held,
    required this.escrow,
    required this.pendingWithdrawals,
    required this.minWithdrawal,
    required this.withdrawalsOpen,
    required this.operators,
  });

  factory WalletSummary.fromJson(Map<String, dynamic> json) => WalletSummary(
    available: json['available'] as int,
    held: json['held'] as int,
    escrow: json['escrow'] as int,
    pendingWithdrawals: json['pendingWithdrawals'] as int,
    minWithdrawal: json['minWithdrawal'] as int,
    withdrawalsOpen: json['withdrawalsOpen'] as bool,
    operators: [for (final o in json['operators'] as List) o as String],
  );

  final int available;
  // Earnings in their security hold.
  final int held;
  final int escrow;
  final int pendingWithdrawals;
  final int minWithdrawal;
  final bool withdrawalsOpen;
  // Operator choice, only where the provider needs it.
  final List<String> operators;
}

const transactionLabels = {
  'DEPOSIT': 'Recharge',
  'ESCROW': 'Séquestre campagne',
  'EARNING': 'Gain',
  'COMMISSION': 'Commission',
  'WITHDRAWAL': 'Retrait',
  'REFUND': 'Remboursement',
};

class WalletTransaction {
  WalletTransaction({
    required this.type,
    required this.amount,
    required this.status,
    required this.availableAt,
    required this.createdAt,
    this.note,
  });

  factory WalletTransaction.fromJson(Map<String, dynamic> json) =>
      WalletTransaction(
        type: json['type'] as String,
        amount: json['amount'] as int,
        status: json['status'] as String,
        availableAt: DateTime.parse(json['availableAt'] as String).toLocal(),
        createdAt: DateTime.parse(json['createdAt'] as String).toLocal(),
        note: json['note'] as String?,
      );

  final String type;
  final int amount;
  final String status;
  final DateTime availableAt;
  final DateTime createdAt;
  final String? note;

  String get label => transactionLabels[type] ?? type;
}

/// A deposit or a withdrawal with the payment provider.
class Payment {
  Payment({
    required this.reference,
    required this.amount,
    required this.status,
    this.checkoutUrl,
    this.failureReason,
  });

  factory Payment.fromJson(Map<String, dynamic> json) => Payment(
    reference: json['reference'] as String,
    amount: json['amount'] as int,
    status: json['status'] as String,
    checkoutUrl: json['checkoutUrl'] as String?,
    failureReason: json['failureReason'] as String?,
  );

  final String reference;
  final int amount;
  final String status;
  final String? checkoutUrl;
  final String? failureReason;
}

String formatFcfa(int amount) {
  final digits = amount.abs().toString();
  final grouped = digits.replaceAllMapped(
    RegExp(r'\B(?=(\d{3})+(?!\d))'),
    (_) => ' ',
  );
  return '${amount < 0 ? '-' : ''}$grouped FCFA';
}
