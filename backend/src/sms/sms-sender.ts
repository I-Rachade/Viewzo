export const SMS_SENDER = Symbol('SMS_SENDER');

export interface SmsSender {
  send(phone: string, message: string): Promise<void>;
}
