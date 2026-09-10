import { platformDefinition } from "@/features/social/services/social-platforms";
import type { SocialPlatform } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "size-5 text-[10px]",
  md: "size-7 text-xs",
  lg: "size-9 text-sm",
} as const;

/**
 * A platform's visual identity, in one place.
 *
 * Used by client settings, the composer's account list, the platform tabs and
 * the preview header, so a platform looks the same everywhere and a new
 * platform inherits that consistency for free.
 *
 * WHAT THIS IS NOT: it is not the platform's logo. Cloud Compass has no
 * licensed brand-icon set — lucide-react ships none (its `X` export is the
 * close icon), no icon pack is installed, and `public/` holds no logo assets.
 * Rather than hand-draw or generate a company's trademark, each platform gets
 * its brand colour and a short monogram, which is honestly Cloud Compass's own
 * mark. Swapping in real logos later means editing this component and the
 * registry — nothing that renders a platform needs to change.
 *
 * No "use client": it is pure presentation, so a server page renders it too.
 */
export default function PlatformMark({
  platform,
  size = "md",
  className,
  /** Set when neighbouring text already names the platform, to avoid a doubled announcement. */
  decorative = false,
}: {
  platform: SocialPlatform;
  size?: keyof typeof SIZES;
  className?: string;
  decorative?: boolean;
}) {
  const definition = platformDefinition(platform);
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-lg font-semibold leading-none", SIZES[size], className)}
      style={{ backgroundColor: definition.brandColor, color: definition.markForeground }}
      aria-hidden={decorative || undefined}
      title={decorative ? undefined : definition.name}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : definition.name}
    >
      {definition.monogram}
    </span>
  );
}
