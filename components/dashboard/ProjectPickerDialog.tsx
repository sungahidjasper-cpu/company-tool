"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ReactNode } from "react";

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
  /** A pre-rendered icon element (e.g. <CheckSquare size={16} />), not a
   * component reference — bare functions can't cross the server/client
   * boundary as props, only rendered React elements can. */
  triggerIcon: ReactNode;
  dialogTitle: string;
  dialogDescription: string;
  projectOptions: ProjectOption[];
  /**
   * A route template containing the literal token ":projectId", e.g.
   * "/projects/:projectId/tasks/new" — a plain, serializable string, not a
   * function. Functions can't cross the Server → Client boundary as props;
   * only serializable values can. The substitution happens here, in the
   * Client Component, once the user has actually picked a project.
   */
  hrefTemplate: string;
};

/**
 * Shared by the "New Task" and "Upload File" quick actions — both need a
 * project picked first (a task always belongs to one; a file's upload
 * form lives on the target's own detail page). One dialog, two callers,
 * instead of duplicating the picker UI.
 */
export default function ProjectPickerDialog({
  triggerLabel,
  triggerIcon,
  dialogTitle,
  dialogDescription,
  projectOptions,
  hrefTemplate,
}: ProjectPickerDialogProps) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(projectOptions[0]?.id ?? "");
  const [open, setOpen] = useState(false);

  const handleGo = () => {
    if (!projectId) return;
    setOpen(false);
    router.push(hrefTemplate.replace(":projectId", projectId));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline">
            {triggerIcon} {triggerLabel}
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
