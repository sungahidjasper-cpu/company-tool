import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));

type MockPrisma = {
  notification: { updateMany: ReturnType<typeof vi.fn> };
};

function createMockPrisma(): MockPrisma {
  return {
    notification: { updateMany: vi.fn() },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { requireUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { markNotificationRead, markAllNotificationsRead } from "@/features/notifications/actions/notification.actions";

const mockedRequireUser = requireUser as unknown as ReturnType<typeof vi.fn>;
const mockedRevalidatePath = revalidatePath as unknown as ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as MockPrisma;

const ACTOR_A = { id: "user-1", role: "EMPLOYEE", companyId: "company-a" };
const ACTOR_B = { id: "user-2", role: "EMPLOYEE", companyId: "company-a" };

describe("markNotificationRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(ACTOR_A);
  });

  it("1. calls updateMany with the exact where/data payload, scoped to the given notification id", async () => {
    await markNotificationRead("notification-1");
    expect(mockedPrisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: "notification-1", userId: "user-1" },
      data: { isRead: true },
    });
  });

  it("2. [CRITICAL] scopes the update to the ACTING user's own id — a different actor produces a different userId filter, never a fixed/hardcoded one", async () => {
    mockedRequireUser.mockResolvedValue(ACTOR_B);
    await markNotificationRead("notification-1");
    expect(mockedPrisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: "notification-1", userId: "user-2" },
      data: { isRead: true },
    });
  });

  it("3. never includes any field beyond isRead in the update data", async () => {
    await markNotificationRead("notification-1");
    const [{ data }] = mockedPrisma.notification.updateMany.mock.calls[0];
    expect(Object.keys(data)).toEqual(["isRead"]);
  });

  it("4. revalidates /dashboard", async () => {
    await markNotificationRead("notification-1");
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("5. returns a plain success result", async () => {
    const result = await markNotificationRead("notification-1");
    expect(result).toEqual({ success: true, data: undefined });
  });
});

describe("markAllNotificationsRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRequireUser.mockResolvedValue(ACTOR_A);
  });

  it("1. calls updateMany with the exact where/data payload, scoped to the acting user's unread notifications only", async () => {
    await markAllNotificationsRead();
    expect(mockedPrisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", isRead: false },
      data: { isRead: true },
    });
  });

  it("2. [CRITICAL] scopes the bulk update to the ACTING user's own id — a different actor produces a different userId filter, never every user's notifications", async () => {
    mockedRequireUser.mockResolvedValue(ACTOR_B);
    await markAllNotificationsRead();
    expect(mockedPrisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-2", isRead: false },
      data: { isRead: true },
    });
  });

  it("3. never includes any field beyond isRead in the update data", async () => {
    await markAllNotificationsRead();
    const [{ data }] = mockedPrisma.notification.updateMany.mock.calls[0];
    expect(Object.keys(data)).toEqual(["isRead"]);
  });

  it("4. revalidates /dashboard", async () => {
    await markAllNotificationsRead();
    expect(mockedRevalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("5. returns a plain success result", async () => {
    const result = await markAllNotificationsRead();
    expect(result).toEqual({ success: true, data: undefined });
  });
});
