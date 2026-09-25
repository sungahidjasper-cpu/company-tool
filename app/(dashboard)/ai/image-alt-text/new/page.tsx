import DashboardHeader from "@/components/dashboard/DashboardHeader";
import EmptyState from "@/components/dashboard/EmptyState";
import PageContainer from "@/components/dashboard/PageContainer";
import { Card, CardContent } from "@/components/ui/card";
import { Image as ImageIcon } from "lucide-react";
import Link from "next/link";

import ImageAltTextPicker, { type ImageOption } from "@/features/ai-workspace/components/ImageAltTextPicker";
import { listProjectImages } from "@/features/ai-workspace/services/project-image-inventory";
import { listSeoProjectOptions } from "@/features/seo/services/seo-project.service";
import { requireUser } from "@/lib/auth";
import { assertPermission, Permissions } from "@/lib/authorization";

/**
 * Loads the image inventory per project, using the same project-scoped query
 * the action and dispatcher use — so what the picker offers and what the
 * server will accept are decided by one rule, not two.
 *
 * listSeoProjectOptions already excludes trashed projects, and every image is
 * fetched by an owned project's id, so no file of another company or another
 * project can reach this page. The server re-verifies all of it regardless.
 */
export default async function NewImageAltTextPage() {
  const user = await requireUser();
  assertPermission(user, Permissions.manageSeoProjects);

  const seoProjectOptions = await listSeoProjectOptions(user.companyId);

  const imagesByProject: Record<string, ImageOption[]> = {};
  await Promise.all(
    seoProjectOptions.map(async (option) => {
      imagesByProject[option.id] = await listProjectImages(option.id);
    })
  );

  return (
    <PageContainer>
      <DashboardHeader
        title="Image Alt Text Generator"
        description="Writes accessible alt text for an image already in your project. The AI cannot see the image — you describe what it shows, and the alt text is written from your description."
      />

      <Card>
        <CardContent>
          {seoProjectOptions.length === 0 ? (
            <EmptyState
              icon={ImageIcon}
              title="No SEO projects yet"
              description="Create an SEO project first, then come back here to write alt text for its images."
              action={
                <Link href="/seo/new" className="text-sm font-medium text-primary hover:underline">
                  Create an SEO project →
                </Link>
              }
            />
          ) : (
            <ImageAltTextPicker seoProjectOptions={seoProjectOptions} imagesByProject={imagesByProject} />
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
