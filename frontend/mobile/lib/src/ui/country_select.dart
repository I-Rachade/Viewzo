import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../api_client.dart';
import '../country_names.dart';

/// 'TG' → 🇹🇬 (two regional indicator letters).
String flagOf(String code) => String.fromCharCodes([
  for (final c in code.toUpperCase().codeUnits) 0x1F1A5 + c,
]);

String countryName(String code) => countryNames[code] ?? code;

/// Countries enabled in the back-office, asked once per [ApiClient].
final _allowed = Expando<Future<List<String>>>();

Future<List<String>> allowedCountries(ApiClient api) {
  return _allowed[api] ??= api.allowedCountries().catchError((Object e) {
    _allowed[api] = null;
    throw e;
  });
}

/// The countries [api] offers, plus [chosen] ones switched off since, so
/// they can still be removed. Empty while loading or offline.
mixin _AllowedCountries<T extends StatefulWidget> on State<T> {
  List<String> _codes = const [];

  void loadCountries(ApiClient api) {
    allowedCountries(api).then(
      (codes) => mounted ? setState(() => _codes = codes) : null,
      onError: (Object _) {},
    );
  }

  List<String> codesWith(Iterable<String> chosen) => [
    ..._codes,
    ...chosen.where((c) => !_codes.contains(c)),
  ];
}

Widget _option(String code) => ShadOption(
  value: code,
  child: Row(
    spacing: 10,
    children: [
      Text(flagOf(code), style: const TextStyle(fontSize: 20)),
      Flexible(child: Text(countryName(code))),
    ],
  ),
);

Widget _flags(Iterable<String> codes) => Text(
  codes.map(flagOf).join(' '),
  style: const TextStyle(fontSize: 20, height: 1.1),
);

/// One country: closed it shows only the flag, open the flag and the name.
class CountrySelect extends StatefulWidget {
  const CountrySelect({
    super.key,
    required this.api,
    required this.value,
    required this.onChanged,
  });
  final ApiClient api;
  final String value;
  final ValueChanged<String> onChanged;

  @override
  State<CountrySelect> createState() => _CountrySelectState();
}

class _CountrySelectState extends State<CountrySelect>
    with _AllowedCountries<CountrySelect> {
  @override
  void initState() {
    super.initState();
    loadCountries(widget.api);
  }

  @override
  Widget build(BuildContext context) {
    return ShadSelect<String>(
      initialValue: widget.value,
      maxHeight: 320,
      options: [
        for (final c in codesWith([widget.value])) _option(c),
      ],
      selectedOptionBuilder: (context, v) =>
          Semantics(label: countryName(v), child: _flags([v])),
      onChanged: (v) => v == null ? null : widget.onChanged(v),
    );
  }
}

/// Several countries: closed it shows the chosen flags side by side.
class CountryMultiSelect extends StatefulWidget {
  const CountryMultiSelect({
    super.key,
    required this.api,
    required this.value,
    required this.onChanged,
    this.placeholder = 'Choisir',
  });
  final ApiClient api;
  final List<String> value;
  final ValueChanged<List<String>> onChanged;
  final String placeholder;

  @override
  State<CountryMultiSelect> createState() => _CountryMultiSelectState();
}

class _CountryMultiSelectState extends State<CountryMultiSelect>
    with _AllowedCountries<CountryMultiSelect> {
  @override
  void initState() {
    super.initState();
    loadCountries(widget.api);
  }

  @override
  Widget build(BuildContext context) {
    return ShadSelect<String>.multiple(
      initialValues: widget.value.toSet(),
      maxHeight: 320,
      allowDeselection: true,
      closeOnSelect: false,
      placeholder: Text(widget.placeholder),
      options: [for (final c in codesWith(widget.value)) _option(c)],
      selectedOptionsBuilder: (context, values) => Semantics(
        label: values.map(countryName).join(', '),
        child: _flags(values),
      ),
      onChanged: (values) => widget.onChanged(values.toList()),
    );
  }
}
