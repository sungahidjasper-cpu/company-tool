import { prisma } from "@/lib/prisma";

const MENTION_PATTERN = /@([A-Za-z]+)/g;

/**
 * Simple @FirstName substring matching against company members — not a
 * rich mention UI (no autocomplete, no @[Name](id) tokens). Good enough to
 * drive a notification; a real mention system is a reasonable future
 * improvement, noted in the Phase 6 report.
 */
export async function extractMentionedUserIds(
  body: string,
  companyId: string,
  excludeUserId: string
): Promise<string[]> {
  const matches = [...body.matchAll(MENTION_PATTERN)].map((match) =>
    match[1].toLowerCase()
  );
  if (matches.length === 0) {
    return [];
  }

  const members = await prisma.user.findMany({
    where: { companyId, deletedAt: null },
    select: { id: true, firstName: true },
  });

  const matchedIds = new Set<string>();
  for (const member of members) {
    if (
      member.id !== excludeUserId &&
      matches.includes(member.firstName.toLowerCase())
    ) {
      matchedIds.add(member.id);
    }
  }

  return Array.from(matchedIds);
}
