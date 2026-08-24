import { beforeEach, describe, expect, it, vi } from "vitest";

type MockPrisma = {
  activity: { create: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
  client: { findUnique: ReturnType<typeof vi.fn> };
  project: { findUnique: ReturnType<typeof vi.fn> };
  task: { findUnique: ReturnType<typeof vi.fn> };
  contact: { findUnique: ReturnType<typeof vi.fn> };
  lead: { findUnique: ReturnType<typeof vi.fn> };
  sEOProject: { findUnique: ReturnType<typeof vi.fn> };
  content: { findUnique: ReturnType<typeof vi.fn> };
};

function createMockPrisma(): MockPrisma {
  return {
    activity: { create: vi.fn().mockResolvedValue({ id: "activity-1" }) },
    user: { findUnique: vi.fn() },
    client: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    task: { findUnique: vi.fn() },
    contact: { findUnique: vi.fn() },
    lead: { findUnique: vi.fn() },
    sEOProject: { findUnique: vi.fn() },
    content: { findUnique: vi.fn() },
  };
}

vi.mock("@/lib/prisma", () => ({ prisma: createMockPrisma() }));

import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity";

const mockedPrisma = prisma as unknown as MockPrisma;

describe("logActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("bug fix: seoProjectId and contentId are persisted", () => {
    it("persists contentId in the Activity row when provided", async () => {
      await logActivity({ actorId: "actor-1", action: "content.updated", companyId: "company-a", contentId: "content-1" });

      expect(mockedPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ contentId: "content-1" }) })
      );
    });

    it("persists seoProjectId in the Activity row when provided", async () => {
      await logActivity({ actorId: "actor-1", action: "seo_project.updated", companyId: "company-a", seoProjectId: "seo-1" });

      expect(mockedPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ seoProjectId: "seo-1" }) })
      );
    });

    it("persists both together, matching call sites that pass both (e.g. content-scoped AI/edit actions)", async () => {
      await logActivity({
        actorId: "actor-1",
        action: "content.ai_long_form_saved",
        companyId: "company-a",
        seoProjectId: "seo-1",
        contentId: "content-1",
      });

      expect(mockedPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ seoProjectId: "seo-1", contentId: "content-1" }) })
      );
    });

    it("omits contentId/seoProjectId (undefined, not a stray null/empty string) when neither is passed", async () => {
      await logActivity({ actorId: "actor-1", action: "client.created", companyId: "company-a", clientId: "client-1" });

      const [{ data }] = mockedPrisma.activity.create.mock.calls[0];
      expect(data.contentId).toBeUndefined();
      expect(data.seoProjectId).toBeUndefined();
    });
  });

  describe("regression: every previously-correct field remains persisted", () => {
    it("persists actorId, action, and metadata", async () => {
      await logActivity({ actorId: "actor-1", action: "client.created", companyId: "company-a", metadata: { name: "Acme" } });

      expect(mockedPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ actorId: "actor-1", action: "client.created", metadata: { name: "Acme" } }) })
      );
    });

    it("defaults actorId to null when omitted (system-originated activity)", async () => {
      await logActivity({ action: "system.event", companyId: "company-a" });

      expect(mockedPrisma.activity.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: null }) }));
    });

    it("persists userId, clientId, contactId, projectId, taskId, and leadId when provided", async () => {
      await logActivity({
        actorId: "actor-1",
        action: "user.invited",
        companyId: "company-a",
        userId: "user-9",
        clientId: "client-1",
        contactId: "contact-1",
        projectId: "project-1",
        taskId: "task-1",
        leadId: "lead-1",
      });

      expect(mockedPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-9",
            clientId: "client-1",
            contactId: "contact-1",
            projectId: "project-1",
            taskId: "task-1",
            leadId: "lead-1",
          }),
        })
      );
    });

    it("uses companyId directly when provided, without a resolution lookup", async () => {
      await logActivity({ actorId: "actor-1", action: "client.created", companyId: "company-a" });

      expect(mockedPrisma.activity.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ companyId: "company-a" }) }));
      expect(mockedPrisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("regression: resolveCompanyId's existing fallback behavior", () => {
    it("resolves companyId from contentId alone via Content -> SEOProject when companyId is not passed directly", async () => {
      mockedPrisma.content.findUnique.mockResolvedValue({ seoProject: { companyId: "resolved-company" } });

      await logActivity({ actorId: "actor-1", action: "content.updated", contentId: "content-1" });

      expect(mockedPrisma.content.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "content-1" } })
      );
      expect(mockedPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ companyId: "resolved-company", contentId: "content-1" }) })
      );
    });

    it("resolves companyId from seoProjectId alone when companyId is not passed directly", async () => {
      mockedPrisma.sEOProject.findUnique.mockResolvedValue({ companyId: "resolved-company" });

      await logActivity({ actorId: "actor-1", action: "seo_project.created", seoProjectId: "seo-1" });

      expect(mockedPrisma.sEOProject.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "seo-1" } })
      );
      expect(mockedPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ companyId: "resolved-company" }) })
      );
    });

    it("resolves companyId from clientId when neither companyId nor a content/seoProject ref is given", async () => {
      mockedPrisma.client.findUnique.mockResolvedValue({ companyId: "resolved-company" });

      await logActivity({ actorId: "actor-1", action: "client.updated", clientId: "client-1" });

      expect(mockedPrisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ companyId: "resolved-company" }) })
      );
    });

    it("resolves companyId to null when no companyId or resolvable ref is provided at all", async () => {
      await logActivity({ actorId: "actor-1", action: "system.event" });

      expect(mockedPrisma.activity.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ companyId: null }) }));
    });
  });
});
