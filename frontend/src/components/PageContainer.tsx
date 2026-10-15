import { ReactNode, ElementType } from "react";

export type PageWidth = "narrow" | "default" | "wide" | "reader";

interface PageContainerProps {
  children: ReactNode;
  width?: PageWidth;
  as?: ElementType;
  className?: string;
}

export default function PageContainer({
  children,
  width = "default",
  as: Component = "main",
  className = "",
}: PageContainerProps) {
  const widthClasses: Record<PageWidth, string> = {
    narrow: "max-w-[480px]",
    default: "max-w-[768px]",
    wide: "max-w-[1152px]",
    reader: "max-w-[1600px]",
  };

  return (
    <Component data-page-container data-page-width={width} className={`w-full min-w-0 mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8 lg:py-10 font-sans ${widthClasses[width]} ${className}`}>
      {children}
    </Component>
  );
}
