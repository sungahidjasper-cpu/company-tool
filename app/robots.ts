import type { MetadataRoute } from "next";

/**
 * Cloud Compass OS is an internal CRM/project/SEO-workspace tool with no
 * public marketing surface — every route except /login sits behind auth
 * (see proxy.ts) and even /login has no value being indexed. Disallowing
 * everything is a deliberate choice, not an oversight — there's nothing
 * here that should ever appear in search results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
