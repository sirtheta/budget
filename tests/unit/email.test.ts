import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SystemSettings } from "@prisma/client";

const { sendMailMock, createTransportMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn().mockResolvedValue(undefined);
  return {
    sendMailMock,
    createTransportMock: vi.fn(() => ({ sendMail: sendMailMock })),
  };
});

vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
}));

import { sendMail } from "@/lib/email";

const ORIGINAL_ENV = { ...process.env };

function settings(overrides: Partial<SystemSettings> = {}): SystemSettings {
  return {
    id: 1,
    currency: "CHF",
    smtpHost: "smtp.example.ch",
    smtpPort: null,
    smtpUser: "user@example.ch",
    smtpPassword: "plaintext-app-password",
    smtpFromName: null,
    smtpFromAddress: null,
    updatedAt: new Date(),
    ...overrides,
  } as SystemSettings;
}

beforeEach(() => {
  createTransportMock.mockClear();
  sendMailMock.mockClear();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("sendMail", () => {
  it("does nothing when DISABLE_EMAIL=true", async () => {
    process.env.DISABLE_EMAIL = "true";
    await sendMail(settings(), "to@x.ch", "Subject", "Body");
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it("throws a German error when SMTP is not fully configured", async () => {
    await expect(
      sendMail(settings({ smtpHost: null }), "to@x.ch", "Subject", "Body")
    ).rejects.toThrow("SMTP nicht konfiguriert");
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it("defaults to port 587 unencrypted-negotiated (secure: false)", async () => {
    await sendMail(settings(), "to@x.ch", "Subject", "Body");
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ port: 587, secure: false })
    );
  });

  it("marks port 465 as secure", async () => {
    await sendMail(settings({ smtpPort: 465 }), "to@x.ch", "Subject", "Body");
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true })
    );
  });

  it("falls back to smtpUser for the from name and address", async () => {
    await sendMail(settings(), "to@x.ch", "Subject", "Body");
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: '"user@example.ch" <user@example.ch>' })
    );
  });

  it("uses smtpFromName / smtpFromAddress when set", async () => {
    await sendMail(
      settings({ smtpFromName: "Haushaltsbudget", smtpFromAddress: "noreply@example.ch" }),
      "to@x.ch",
      "Subject",
      "Body"
    );
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: '"Haushaltsbudget" <noreply@example.ch>' })
    );
  });

  it("escapes quotes and backslashes in the display name", async () => {
    await sendMail(settings({ smtpFromName: 'Bud"get\\App' }), "to@x.ch", "Subject", "Body");
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.stringContaining('Bud\\"get\\\\App') })
    );
  });

  it("strips newlines from the display name", async () => {
    await sendMail(settings({ smtpFromName: "Line1\nLine2\r" }), "to@x.ch", "Subject", "Body");
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.stringContaining("Line1 Line2 ") })
    );
  });

  it("sends the plain-text body and an escaped HTML rendering", async () => {
    await sendMail(settings(), "to@x.ch", "Betreff", "Zeile 1 & <wichtig>\nZeile 2");
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "to@x.ch",
        subject: "Betreff",
        text: "Zeile 1 & <wichtig>\nZeile 2",
        html: expect.stringContaining("Zeile 1 &amp; &lt;wichtig&gt;<br>Zeile 2"),
      })
    );
    expect(sendMailMock.mock.calls[0][0].html).toContain('name="format-detection"');
  });
});
