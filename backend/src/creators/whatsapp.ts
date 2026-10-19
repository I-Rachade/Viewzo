// Builds the WhatsApp Statut verification steps: the official number to save
// and the prefilled message carrying the creator's code.
export function parseVerificationNumbers(raw: string | undefined) {
  const numbers = new Map<string, string>();
  for (const entry of (raw ?? '').split(',')) {
    const [country, phone] = entry.split(':').map((s) => s.trim());
    if (country && phone) numbers.set(country.toUpperCase(), phone);
  }
  return numbers;
}

export function whatsappInstructions(contactNumber: string, code: string) {
  const messageText = `Bonjour Viewzo, je vérifie mon compte. Code : ${code}`;
  return {
    kind: 'WHATSAPP' as const,
    code,
    contactNumber,
    messageText,
    whatsappLink: `https://wa.me/${contactNumber.replace(/\D/g, '')}?text=${encodeURIComponent(messageText)}`,
  };
}
