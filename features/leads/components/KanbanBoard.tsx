"use client";

import {
  DndContext,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { moveLeadStatus } from "@/features/leads/actions/lead.actions";
import { LEAD_STATUSES } from "@/features/leads/schemas/lead.schema";
import { formatEnumLabel } from "@/lib/utils";

type LeadCard = {
  id: string;
  name: string;
  companyName: string | null;
  value: string | null;
  assignedUserId: string | null;
  assignedUser: { id: string; firstName: string; lastName: string } | null;
};

type Stage = {
  status: (typeof LEAD_STATUSES)[number];
  leads: LeadCard[];
};

type KanbanBoardProps = {
  stages: Stage[];
  currentUserId: string;
  canManageLeads: boolean;
};

function canDragLead(lead: LeadCard, currentUserId: string, canManageLeads: boolean) {
  return canManageLeads || lead.assignedUserId === currentUserId;
}

function LeadCardView({
  lead,
  draggable,
}: {
  lead: LeadCard;
  draggable: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
    disabled: !draggable,
  });

  return (
    <div
      ref={setNodeRef}
      {...(draggable ? { ...attributes, ...listeners } : {})}
      className={`rounded-lg border border-slate-200 bg-white p-3 shadow-sm ${
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-default"
      } ${isDragging ? "opacity-50" : ""}`}
    >
      <Link
        href={`/leads/${lead.id}`}
        className="text-sm font-medium hover:underline"
        onClick={(event) => draggable && isDragging && event.preventDefault()}
      >
        {lead.name}
      </Link>
      {lead.companyName && (
        <p className="text-xs text-slate-500">{lead.companyName}</p>
      )}
      <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
        <span>
          {lead.assignedUser
            ? `${lead.assignedUser.firstName} ${lead.assignedUser.lastName}`
            : "Unassigned"}
        </span>
        {lead.value && <span>${Number(lead.value).toLocaleString()}</span>}
      </div>
    </div>
  );
}

function StageColumn({
  stage,
  currentUserId,
  canManageLeads,
}: {
  stage: Stage;
  currentUserId: string;
  canManageLeads: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.status });
  const totalValue = stage.leads.reduce(
    (sum, lead) => sum + (lead.value ? Number(lead.value) : 0),
    0
  );

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[200px] w-72 flex-shrink-0 flex-col gap-2 rounded-xl border p-3 ${
        isOver ? "border-primary bg-primary/5" : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-semibold">{formatEnumLabel(stage.status)}</h3>
        <span className="text-xs text-slate-500">{stage.leads.length}</span>
      </div>
      {totalValue > 0 && (
        <p className="px-1 text-xs text-slate-400">
          ${totalValue.toLocaleString()}
        </p>
      )}
      <div className="flex flex-col gap-2">
        {stage.leads.map((lead) => (
          <LeadCardView
            key={lead.id}
            lead={lead}
            draggable={canDragLead(lead, currentUserId, canManageLeads)}
          />
        ))}
      </div>
    </div>
  );
}

export default function KanbanBoard({
  stages: initialStages,
  currentUserId,
  canManageLeads,
}: KanbanBoardProps) {
  const [stages, setStages] = useState(initialStages);
  const [, startTransition] = useTransition();

  const handleDragEnd = (event: DragEndEvent) => {
    const leadId = String(event.active.id);
    const targetStatus = event.over?.id as Stage["status"] | undefined;
    if (!targetStatus) return;

    const sourceStage = stages.find((stage) =>
      stage.leads.some((lead) => lead.id === leadId)
    );
    const lead = sourceStage?.leads.find((item) => item.id === leadId);
    if (!sourceStage || !lead || sourceStage.status === targetStatus) return;

    const previousStages = stages;

    setStages((current) =>
      current.map((stage) => {
        if (stage.status === sourceStage.status) {
          return { ...stage, leads: stage.leads.filter((item) => item.id !== leadId) };
        }
        if (stage.status === targetStatus) {
          return { ...stage, leads: [lead, ...stage.leads] };
        }
        return stage;
      })
    );

    startTransition(async () => {
      const result = await moveLeadStatus(leadId, targetStatus);
      if (!result.success) {
        toast.error(result.message);
        setStages(previousStages);
        return;
      }
      toast.success(`Moved to ${formatEnumLabel(targetStatus)}`);
    });
  };

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map((stage) => (
          <StageColumn
            key={stage.status}
            stage={stage}
            currentUserId={currentUserId}
            canManageLeads={canManageLeads}
          />
        ))}
      </div>
    </DndContext>
  );
}
