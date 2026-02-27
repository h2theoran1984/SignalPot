interface BadgeProps {
  children: React.ReactNode;
  variant?: "status" | "plan" | "tag" | "trust";
  status?: "active" | "inactive" | "deprecated" | "pending" | "running" | "completed" | "failed";
  className?: string;
}

const statusClasses: Record<string, string> = {
  active: "bg-emerald-950 text-emerald-400 border-emerald-900",
  inactive: "bg-gray-900 text-gray-400 border-gray-800",
  deprecated: "bg-gray-900 text-gray-500 border-gray-800",
  pending: "bg-yellow-950 text-yellow-400 border-yellow-900",
  running: "bg-blue-950 text-blue-400 border-blue-900",
  completed: "bg-emerald-950 text-emerald-400 border-emerald-900",
  failed: "bg-red-950 text-red-400 border-red-900",
};

const planClasses: Record<string, string> = {
  free: "bg-gray-900 text-gray-400 border-gray-700",
  pro: "bg-cyan-950 text-cyan-400 border-cyan-800",
  team: "bg-purple-950 text-purple-400 border-purple-800",
};

export function Badge({ children, variant = "tag", status, className = "" }: BadgeProps) {
  let classes = "inline-flex items-center px-2 py-0.5 text-xs rounded border font-medium";

  if (variant === "status" && status) {
    classes += " " + (statusClasses[status] ?? "bg-gray-900 text-gray-400 border-gray-800");
  } else if (variant === "plan") {
    const plan = typeof children === "string" ? children.toLowerCase() : "free";
    classes += " " + (planClasses[plan] ?? planClasses.free);
  } else if (variant === "trust") {
    classes += " bg-cyan-950 text-cyan-400 border-cyan-900";
  } else {
    // tag variant
    classes += " bg-gray-900 text-gray-400 border-gray-800 hover:border-gray-600 hover:text-gray-300 transition-colors";
  }

  return (
    <span className={[classes, className].join(" ")}>
      {children}
    </span>
  );
}
