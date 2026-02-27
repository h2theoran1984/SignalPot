interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  glow?: boolean;
}

export function Card({ children, className = "", hover = false, glow = false }: CardProps) {
  return (
    <div
      className={[
        "bg-[#111118] border border-[#1f2028] rounded-lg",
        hover && "hover:border-[#2d3044] hover:glow-cyan-sm transition-all cursor-pointer",
        glow && "glow-cyan",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function CardHeader({ children, className = "" }: CardHeaderProps) {
  return (
    <div className={["px-5 py-4 border-b border-[#1f2028]", className].join(" ")}>
      {children}
    </div>
  );
}

interface CardBodyProps {
  children: React.ReactNode;
  className?: string;
}

export function CardBody({ children, className = "" }: CardBodyProps) {
  return (
    <div className={["px-5 py-4", className].join(" ")}>
      {children}
    </div>
  );
}
