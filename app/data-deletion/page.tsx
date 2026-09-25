import type { Metadata } from "next";

import LegalPageShell, { LegalSection } from "@/components/legal/LegalPageShell";

export const metadata: Metadata = {
  title: { absolute: "Data Deletion | Cloud Compass OS" },
  description: "Instructions for requesting deletion of data associated with Cloud Compass OS.",
};

/**
 * Public, unauthenticated data-deletion instructions page.
 *
 * No deletion callback is implemented here — this page only explains the
 * request process, per this task's explicit scope. Meta's own "Data Deletion
 * Instructions URL" requirement can be satisfied by a URL like this one; it
 * does not require an automated callback endpoint.
 */
export default function DataDeletionPage() {
  return (
    <LegalPageShell title="Data Deletion" lastUpdated="September 12, 2026">
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900">
        This page is an informational draft describing the deletion-request process for Cloud
        Compass OS as currently built. It should be reviewed by Cloud Sherpas&apos;s business or legal
        owner before being relied on for production use or a Meta App Review submission.
      </p>

      <LegalSection heading="What You Can Request">
        <p>You may request deletion of:</p>
        <ul className="ml-5 list-disc">
          <li>your Cloud Compass account and workspace membership information;</li>
          <li>information about a connected social media account, including any stored authorization credential for it; and</li>
          <li>other personal information associated with your use of Cloud Compass.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="How to Submit a Request">
        <p>
          Send a deletion request to the contact below. Include enough detail for us to locate your
          information — see &quot;What to Include&quot; below.
        </p>
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 font-medium text-slate-800">
          Privacy/deletion contact: [BUSINESS OWNER TO PROVIDE EMAIL]
        </p>
      </LegalSection>

      <LegalSection heading="What to Include">
        <ul className="ml-5 list-disc">
          <li>the name and email address associated with your Cloud Compass account, if you have one;</li>
          <li>the workspace or company name, if known;</li>
          <li>if your request relates to a connected Facebook/Meta account: the Facebook account or Page name you connected; and</li>
          <li>a description of what you are asking to have deleted.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="How Requests Are Processed">
        <p>
          Requests are reviewed and processed in accordance with applicable law and Cloud Compass&apos;s
          retention obligations. We will confirm once a request has been completed. Certain
          information may need to be retained where legally required, or where necessary for
          legitimate business, accounting, or security purposes (for example, records needed to
          resolve a dispute or comply with a legal obligation) even after a deletion request.
        </p>
      </LegalSection>

      <LegalSection heading="Disconnecting a Social Account">
        <p>
          Disconnecting a connected social media account (such as a Facebook Page) from Cloud
          Compass is a separate action from deleting your broader Cloud Compass account or workspace
          data, and can be done independently. Disconnecting removes the stored authorization for
          that account; it does not by itself delete other Cloud Compass workspace data, and
          deleting your Cloud Compass account does not by itself revoke authorization granted
          directly through Facebook&apos;s own account settings.
        </p>
      </LegalSection>

      <LegalSection heading="Related">
        <p>
          See our{" "}
          <a href="/privacy" className="font-medium text-[#2F4156] underline">
            Privacy Policy
          </a>{" "}
          for more on what information Cloud Compass may process and why.
        </p>
      </LegalSection>
    </LegalPageShell>
  );
}
