"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

type ProjectOption = { id: string; name: string };

type ProjectPickerDialogProps = {
  triggerLabel: string;
  triggerIcon: LucideIcon;
  dialogTitle: string;
  dialogDescription: string;
  projectOptions: ProjectOption[];
  buildHref: (projectId: string) => string;
};

/**
 * Shared by the "New Task" and "Upload File" quick actions — both need a
 * project picked first (a task always belongs to one; a file's upload
 * form lives on the target's own detail page). One dialog, two callers,
 * instead of duplicating the picker UI.
 */
export default function ProjectPickerDialog({
  triggerLabel,
  triggerIcon: Icon,
  dialogTitle,
  dialogDescription,
  projectOptions,
  buildHref,
}: ProjectPickerDialogProps) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(projectOptions[0]?.id ?? "");
  const [open, setOpen] = useState(false);

  const handleGo = () => {
    if (!projectId) return;
    setOpen(false);
    router.push(buildHref(projectId));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline">
            <Icon size={16} /> {triggerLabel}
          </Button>
        }
      />

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        {projectOptions.length === 0 ? (
          <p className="text-sm text-slate-500">
            Create a project first before using this shortcut.
          </p>
        ) : (
          <select
            className={selectClassName}
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        )}

        <DialogFooter>
          <Button
            type="button"
            onClick={handleGo}
            disabled={projectOptions.length === 0}
          >
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
