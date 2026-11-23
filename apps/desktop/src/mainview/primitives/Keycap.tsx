import "./keycap.css";

const arrows: Readonly<Record<string, string>> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
};

export function Keycap({ children }: { children: string }) {
  return (
    <kbd className="ui-keycap">
      {Object.hasOwn(arrows, children) ? arrows[children] : children}
    </kbd>
  );
}
