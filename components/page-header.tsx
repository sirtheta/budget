export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  /** Actions rendered on the right, e.g. a "Neu" button. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </div>
      {children && <div className="flex items-center flex-wrap gap-2">{children}</div>}
    </div>
  );
}
