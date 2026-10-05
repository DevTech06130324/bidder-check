import { expect, it, vi } from "vitest";
vi.mock("@/lib/data", () => ({ getWorkspaceData: async () => ({ profile: { role: "admin" } }) }));
vi.mock("@/components/people", () => ({ People: () => null }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
import Users from "@/app/(workspace)/users/page";
it("opens an archived signup alert in the highlighted archived people view", async () => {
  const page = await Users({ searchParams: Promise.resolve({ tab: "archived", highlight: "client-id" }) });
  expect(page.props).toMatchObject({ initialTab: "archived", highlightId: "client-id" });
});
