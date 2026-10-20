export const MAIL_SENDER = Symbol('MAIL_SENDER');

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailSender {
  send(mail: Mail): Promise<void>;
}
