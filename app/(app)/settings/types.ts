/**
 * The settings fields the form may receive.
 *
 * `smtpPassword` is deliberately absent: this object is handed to a Client
 * Component, so every field lands in the RSC payload sent to the browser.
 * Whether one is stored is communicated by the separate `hasSmtpPassword`
 * boolean — typing the prop as Prisma's `SystemSettings` previously shipped
 * the encrypted credential itself.
 */
export interface EditableSettings {
  currency: string;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpFromName: string | null;
  smtpFromAddress: string | null;
}
