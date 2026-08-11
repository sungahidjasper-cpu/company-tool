"use client";

import { useRouter } from "next/navigation";

const selectClassName =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type ClusterFilterSelectProps = {
  seoProjectId: string;
  clusterOptions: { id: string; name: string }[];
  currentClusterId?: string;
  q?: string;
  status?: string;
};

export default function ClusterFilterSelect({
  seoProjectId,
  clusterOptions,
  currentClusterId,
  q,
  status,
}: ClusterFilterSelectProps) {
  const router = useRouter();

  const handleChange = (clusterId: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (clusterId) params.set("clusterId", clusterId);
    router.push(`/seo/${seoProjectId}/keywords?${params.toString()}`);
  };

  return (
    <select
      className={selectClassName}
      value={currentClusterId ?? ""}
      onChange={(event) => handleChange(event.target.value)}
    >
      <option value="">All clusters</option>
      {clusterOptions.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
        </option>
      ))}
    </select>
  );
}
