type PageTitleProps = {
  title: string;
  description?: string;
};

export default function PageTitle({ title, description }: PageTitleProps) {
  return (
    <div>
      <h2 className="text-3xl font-bold">{title}</h2>

      {description && (
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      )}
    </div>
  );
}
