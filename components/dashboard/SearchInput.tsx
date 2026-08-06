import type { VariantProps } from "class-variance-authority";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SearchInputProps = {
  action: string;
  defaultValue?: string;
  placeholder?: string;
  hiddenFields?: Record<string, string>;
  buttonVariant?: VariantProps<typeof buttonVariants>["variant"];
};

export default function SearchInput({
  action,
  defaultValue,
  placeholder = "Search...",
  hiddenFields,
  buttonVariant = "outline",
}: SearchInputProps) {
  return (
    <form action={action} method="GET" className="flex gap-2">
      {hiddenFields &&
        Object.entries(hiddenFields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}

      <Input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="max-w-sm"
      />

      <Button type="submit" variant={buttonVariant}>
        Search
      </Button>
    </form>
  );
}
