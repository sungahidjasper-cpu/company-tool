type PageContainerProps = {
  children: React.ReactNode;
};

export default function PageContainer({ children }: PageContainerProps) {
  return <div className="flex flex-col gap-8">{children}</div>;
}
