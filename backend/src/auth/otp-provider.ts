export const OTP_PROVIDER = Symbol('OTP_PROVIDER');

// Sends a one-time code to a phone number and checks it.
// Throws an HttpException when sending is refused or the code is wrong.
export interface OtpProvider {
  request(phone: string): Promise<void>;
  verify(phone: string, code: string): Promise<void>;
}
