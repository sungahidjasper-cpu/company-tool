export const DEFAULT_PAGE_SIZE = 10;

export type ListSearchParams = {
  page?: string;
  q?: string;
  status?: string;
};

export function parseListParams(
  searchParams: ListSearchParams,
  pageSize = DEFAULT_PAGE_SIZE
) {
  const page = Math.max(1, Number(searchParams.page) || 1);
  const q = searchParams.q?.trim() || undefined;
  const status = searchParams.status?.trim() || undefined;

  return {
    page,
    pageSize,
    q,
    status,
    skip: (page - 1) * pageSize,
  };
}

export function getTotalPages(totalCount: number, pageSize: number) {
  return Math.max(1, Math.ceil(totalCount / pageSize));
}
