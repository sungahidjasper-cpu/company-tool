import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type SeoCrawledPagesTabProps = {
  crawledPages: { url: string; title: string | null }[];
  sitemapUrlCount: number;
};

export default function SeoCrawledPagesTab({ crawledPages, sitemapUrlCount }: SeoCrawledPagesTabProps) {
  return (
    <div>
      <h4 className="mb-2 text-sm font-medium">
        Crawled pages ({crawledPages.length} of {sitemapUrlCount} sitemap URLs)
      </h4>
      <div className="rounded-xl border border-slate-200">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>URL</TableHead>
              <TableHead>Title</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {crawledPages.map((page) => (
              <TableRow key={page.url}>
                <TableCell className="max-w-xs truncate text-slate-500">
                  <a href={page.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {page.url}
                  </a>
                </TableCell>
                <TableCell>{page.title ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
