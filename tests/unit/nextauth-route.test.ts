import { describe, expect, it, vi } from "vitest";

const { fakeGet, fakePost } = vi.hoisted(() => ({
  fakeGet: vi.fn(),
  fakePost: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ handlers: { GET: fakeGet, POST: fakePost } }));

import { GET, POST } from "@/app/api/auth/[...nextauth]/route";

describe("[...nextauth] route", () => {
  it("re-exports next-auth's own handlers unchanged", () => {
    expect(GET).toBe(fakeGet);
    expect(POST).toBe(fakePost);
  });
});
